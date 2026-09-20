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
    GradeMixSchema,
)
from app.utils import validation_error_response

bp = Blueprint("flush_harvests", __name__, url_prefix="/api/flush-harvests")

create_schema = FlushHarvestCreateSchema()
appeal_create_schema = GradeAppealCreateSchema()
out_schema = FlushHarvestOutSchema()
grade_mix_schema = GradeMixSchema()


def effective_grade(item: FlushHarvest) -> str:
    """有效等级：有改判取最新一笔（appealed_at 最晚，平手取 id 更大者），否则取原 grade。"""
    appeals = item.grade_appeals  # 关系已按 appealed_at desc, id desc 排序
    return appeals[0].next_grade if appeals else item.grade


def serialize(item: FlushHarvest) -> dict:
    data = out_schema.dump(item)
    data["originalGrade"] = item.grade
    data["effectiveGrade"] = effective_grade(item)
    data["appealCount"] = len(item.grade_appeals)
    return data


def _base_query(db):
    return db.query(FlushHarvest).options(selectinload(FlushHarvest.grade_appeals))


@bp.get("")
@jwt_required()
def list_flush_harvests():
    db = SessionLocal()
    try:
        room_id = request.args.get("roomId", type=int)
        q = _base_query(db)
        if room_id is not None:
            q = q.filter(FlushHarvest.room_id == room_id)
        rows = q.order_by(FlushHarvest.harvested_at.desc()).all()
        return jsonify([serialize(item) for item in rows])
    finally:
        db.close()


@bp.get("/grade-mix")
@jwt_required()
def grade_mix():
    db = SessionLocal()
    try:
        room_id = request.args.get("roomId", type=int)
        q = _base_query(db)
        if room_id is not None:
            q = q.filter(FlushHarvest.room_id == room_id)
        rows = q.all()
        buckets = {"A": 0.0, "B": 0.0, "C": 0.0}
        for item in rows:
            buckets[effective_grade(item)] += item.weight_kg
        mix = [
            {"grade": g, "weight_kg": buckets[g]}
            for g in ("A", "B", "C")
            if buckets[g] > 0
        ]
        payload = {"mix": mix, "total_kg": sum(buckets.values())}
        return jsonify(grade_mix_schema.dump(payload))
    finally:
        db.close()


@bp.get("/<int:harvest_id>")
@jwt_required()
def get_flush_harvest(harvest_id: int):
    db = SessionLocal()
    try:
        item = (
            _base_query(db).filter(FlushHarvest.id == harvest_id).first()
        )
        if not item:
            return jsonify({"detail": "采收记录不存在"}), 404
        return jsonify(serialize(item))
    finally:
        db.close()


@bp.post("/<int:harvest_id>/appeals")
@jwt_required()
def create_grade_appeal(harvest_id: int):
    db = SessionLocal()
    try:
        item = db.query(FlushHarvest).filter(FlushHarvest.id == harvest_id).first()
        if not item:
            return jsonify({"detail": "采收记录不存在"}), 404
        try:
            data = appeal_create_schema.load(request.get_json(silent=True) or {})
        except ValidationError as err:
            return validation_error_response(err)
        current = effective_grade(item)
        if data["next_grade"] == current:
            return jsonify({"detail": f"nextGrade 不能等于当前有效等级 {current}"}), 400
        appeal = GradeAppeal(
            harvest_id=item.id,
            next_grade=data["next_grade"],
            reason=data["reason"].strip(),
            appealed_at=data["appealed_at"],
        )
        db.add(appeal)
        db.commit()
        db.refresh(item)
        return jsonify(serialize(item)), 201
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
        return jsonify(serialize(item)), 201
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
