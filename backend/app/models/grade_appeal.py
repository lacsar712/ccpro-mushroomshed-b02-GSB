from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class GradeAppeal(Base):
    """等级改判记录。只追加,不覆盖 FlushHarvest.grade。"""

    __tablename__ = "grade_appeals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    harvest_id: Mapped[int] = mapped_column(
        ForeignKey("flush_harvests.id"), nullable=False, index=True
    )
    next_grade: Mapped[str] = mapped_column(String(1), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    appealed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    harvest: Mapped["FlushHarvest"] = relationship("FlushHarvest", back_populates="appeals")
