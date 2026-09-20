from marshmallow import Schema, fields, post_load, validate

ALLOWED_GRADES = ["A", "B", "C"]


def _reason_stripped_len(value: str) -> None:
    if len(value.strip()) < 6:
        raise validate.ValidationError("reason 去掉空白后至少 6 个字")


class FlushHarvestCreateSchema(Schema):
    room_id = fields.Int(required=True, data_key="roomId")
    harvested_at = fields.DateTime(required=True, data_key="harvestedAt")
    flush_no = fields.Int(required=True, data_key="flushNo", validate=validate.Range(min=1))
    weight_kg = fields.Float(
        required=True,
        data_key="weightKg",
        validate=validate.Range(min=0.0001, error="weightKg 须大于 0"),
    )
    grade = fields.Str(required=True, validate=validate.OneOf(ALLOWED_GRADES))
    operator_name = fields.Str(required=True, data_key="operatorName", validate=validate.Length(min=1, max=64))


class GradeAppealCreateSchema(Schema):
    # harvestId 由 URL 路径提供,原等级冻结不随 body 传入
    next_grade = fields.Str(
        required=True,
        data_key="nextGrade",
        validate=validate.OneOf(ALLOWED_GRADES, error="nextGrade 只接受 A、B、C"),
    )
    reason = fields.Str(required=True, validate=[validate.Length(min=1, max=1000), _reason_stripped_len])

    @post_load
    def _strip_reason(self, data, **kwargs):
        data["reason"] = data["reason"].strip()
        return data


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
    original_grade = fields.Str(data_key="originalGrade")
    effective_grade = fields.Str(data_key="effectiveGrade")
    appeal_count = fields.Int(data_key="appealCount")
    appeals = fields.List(fields.Nested(GradeAppealOutSchema))
