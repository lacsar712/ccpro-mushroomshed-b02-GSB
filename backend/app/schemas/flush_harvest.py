from datetime import datetime, timezone

from marshmallow import Schema, fields, validate


class FlushHarvestCreateSchema(Schema):
    room_id = fields.Int(required=True, data_key="roomId")
    harvested_at = fields.DateTime(required=True, data_key="harvestedAt")
    flush_no = fields.Int(required=True, data_key="flushNo", validate=validate.Range(min=1))
    weight_kg = fields.Float(
        required=True,
        data_key="weightKg",
        validate=validate.Range(min=0.0001, error="weightKg 须大于 0"),
    )
    grade = fields.Str(required=True, validate=validate.OneOf(["A", "B", "C"]))
    operator_name = fields.Str(required=True, data_key="operatorName", validate=validate.Length(min=1, max=64))


def _reason_nonblank(value: str) -> None:
    if len(value.strip()) < 6:
        raise validate.ValidationError("reason 去掉空白后至少 6 个字")


class GradeAppealCreateSchema(Schema):
    next_grade = fields.Str(
        required=True, data_key="nextGrade", validate=validate.OneOf(["A", "B", "C"])
    )
    reason = fields.Str(required=True, validate=_reason_nonblank)
    appealed_at = fields.DateTime(
        data_key="appealedAt", load_default=lambda: datetime.now(timezone.utc)
    )


class GradeAppealOutSchema(Schema):
    id = fields.Int(dump_only=True)
    harvest_id = fields.Int(data_key="harvestId")
    next_grade = fields.Str(data_key="nextGrade")
    reason = fields.Str()
    appealed_at = fields.DateTime(data_key="appealedAt")


class FlushHarvestOutSchema(Schema):
    id = fields.Int(dump_only=True)
    room_id = fields.Int(data_key="roomId")
    harvested_at = fields.DateTime(data_key="harvestedAt")
    flush_no = fields.Int(data_key="flushNo")
    weight_kg = fields.Float(data_key="weightKg")
    grade = fields.Str()
    operator_name = fields.Str(data_key="operatorName")
    appeals = fields.List(
        fields.Nested(GradeAppealOutSchema()), attribute="grade_appeals"
    )


class GradeMixItemSchema(Schema):
    grade = fields.Str()
    weight_kg = fields.Float(data_key="weightKg")


class GradeMixSchema(Schema):
    mix = fields.List(fields.Nested(GradeMixItemSchema()))
    total_kg = fields.Float(data_key="totalKg")
