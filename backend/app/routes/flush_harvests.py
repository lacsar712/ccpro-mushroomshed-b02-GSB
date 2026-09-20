from collections import defaultdict
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required
from marshmallow import ValidationError
from sqlalchemy.orm import selectinload

from app.database import SessionLocal
from app.models.flush_harvest import FlushHarvest
from app.models.grade_appeal import GradeAppeal
from app.models.room import Room
from app.schemas.flush_harvest import (
    FlushHarvestCreateSchema,
    FlushHarvestOutSchema,
    GradeAppealCreateSchema,
    GradeAppealOutSchema,
)
from app.utils import validation_error_response

bp = Blueprint("flush_harvests", __name__, url_prefix="/api/flush-harvests")

create_schema = FlushHarvestCreateSchema()
appeal_create_schema = GradeAppealCreateSchema()
out_schema = FlushHarvestOutSchema()
out_many = FlushHarvestOutSchema(many=True)
appeal_out_schema = GradeAppealOutSchema()


def _as_utc(dt: datetime) -> datetime:
    """统一成 UTC 可比时间;裸时间按 UTC 处理。"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _load_harvests(db, room_id=None):
    q = db.query(FlushHarvest).options(selectinload(FlushHarvest.appeals))
    if room_id is not None:
        q = q.filter(FlushHarvest.room_id == room_id)
    return q.order_by(FlushHarvest.harvested_at.desc()).all()


def _appeal_index(rows):
    """返回 latest(harvest_id -> 有效改判) 与 counts;同一时刻取 id 更大者。"""
    latest = {}
    counts = defaultdict(int)
    grouped = defaultdict(list)
    for h in rows:
        for a in h.appeals:
            counts[h.id] += 1
            grouped[h.id].append(a)
            cur = latest.get(h.id)
            if cur is None or (_as_utc(a.appealed_at), a.id) > (
                _as_utc(cur.appealed_at),
                cur.id,
            ):
                latest[h.id] = a
    # 各笔按 appealedAt 倒序、同刻按 id 倒序
    for items in grouped.values():
        items.sort(key=lambda a: (_as_utc(a.appealed_at), a.id), reverse=True)
    return latest, counts, grouped


def _serialize(rows):
    """列表/单条/grade-mix 共用的有效等级口径。"""
    latest, counts, grouped = _appeal_index(rows)
    payload = []
    for h in rows:
        effective = latest[h.id].next_grade if h.id in latest else h.grade
        payload.append(
            {
                "id": h.id,
                "room_id": h.room_id,
                "harvested_at": h.harvested_at,
                "flush_no": h.flush_no,
                "weight_kg": h.weight_kg,
                "grade": h.grade,
                "operator_name": h.operator_name,
                "original_grade": h.grade,
                "effective_grade": effective,
                "appeal_count": counts[h.id],
                "appeals": [
                    {
                        "id": a.id,
                        "harvest_id": a.harvest_id,
                        "next_grade": a.next_grade,
                        "reason": a.reason,
                        "appealed_at": a.appealed_at,
                    }
                    for a in grouped[h.id]
                ],
            }
        )
    return payload


@bp.get("")
@jwt_required()
def list_flush_harvests():
    db = SessionLocal()
    try:
        room_id = request.args.get("roomId", type=int)
        rows = _load_harvests(db, room_id)
        return jsonify(out_many.dump(_serialize(rows)))
    finally:
        db.close()


@bp.get("/grade-mix")
@jwt_required()
def grade_mix():
    """按有效等级汇总公斤。口径必须与列表 effectiveGrade 一致。"""
    db = SessionLocal()
    try:
        room_id = request.args.get("roomId", type=int)
        rows = _load_harvests(db, room_id)
        totals = {"A": 0.0, "B": 0.0, "C": 0.0}
        for item in _serialize(rows):
            totals[item["effective_grade"]] += item["weight_kg"]
        return jsonify(
            [
                {"grade": grade, "weightKg": round(totals[grade], 6)}
                for grade in ("A", "B", "C")
            ]
        )
    finally:
        db.close()


@bp.post("")
@jwt_required()
def create_flush_harvest():
    db = SessionLocal()
    try:
        try:
            data = create_schema.load(request.get_json(silent=True) or {})
        except ValidationError as err:
            return validation_error_response(err)
        room = db.query(Room).filter(Room.id == data["room_id"]).first()
        if not room:
            return jsonify({"detail": "出菇室不存在"}), 400
        item = FlushHarvest(
            room_id=data["room_id"],
            harvested_at=data["harvested_at"],
            flush_no=data["flush_no"],
            weight_kg=data["weight_kg"],
            grade=data["grade"],
            operator_name=data["operator_name"],
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        row = (
            db.query(FlushHarvest)
            .options(selectinload(FlushHarvest.appeals))
            .filter(FlushHarvest.id == item.id)
            .one()
        )
        return jsonify(out_schema.dump(_serialize([row])[0])), 201
    finally:
        db.close()


@bp.post("/<int:harvest_id>/appeals")
@jwt_required()
def create_grade_appeal(harvest_id: int):
    db = SessionLocal()
    try:
        try:
            data = appeal_create_schema.load(request.get_json(silent=True) or {})
        except ValidationError as err:
            return validation_error_response(err)
        harvest = (
            db.query(FlushHarvest)
            .options(selectinload(FlushHarvest.appeals))
            .filter(FlushHarvest.id == harvest_id)
            .first()
        )
        if not harvest:
            return jsonify({"detail": "采收记录不存在"}), 404

        latest, _, _ = _appeal_index([harvest])
        current_grade = (
            latest[harvest.id].next_grade if harvest.id in latest else harvest.grade
        )
        if data["next_grade"] == current_grade:
            return jsonify({"detail": "nextGrade 不能等于当前有效等级"}), 400

        appeal = GradeAppeal(
            harvest_id=harvest.id,
            next_grade=data["next_grade"],
            reason=data["reason"],
            appealed_at=datetime.now(timezone.utc),
        )
        db.add(appeal)
        db.commit()
        db.refresh(appeal)
        return jsonify(appeal_out_schema.dump(appeal)), 201
    finally:
        db.close()


@bp.get("/<int:harvest_id>")
@jwt_required()
def get_flush_harvest(harvest_id: int):
    db = SessionLocal()
    try:
        row = (
            db.query(FlushHarvest)
            .options(selectinload(FlushHarvest.appeals))
            .filter(FlushHarvest.id == harvest_id)
            .first()
        )
        if not row:
            return jsonify({"detail": "采收记录不存在"}), 404
        return jsonify(out_schema.dump(_serialize([row])[0]))
    finally:
        db.close()


@bp.delete("/<int:harvest_id>")
@jwt_required()
def delete_flush_harvest(harvest_id: int):
    db = SessionLocal()
    try:
        item = db.query(FlushHarvest).filter(FlushHarvest.id == harvest_id).first()
        if not item:
            return jsonify({"detail": "采收记录不存在"}), 404
        db.delete(item)
        db.commit()
        return "", 204
    finally:
        db.close()
