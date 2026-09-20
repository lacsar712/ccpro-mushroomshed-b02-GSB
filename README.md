# MushroomShed-01 · 菇房出菇台账

食用菌菇房「出菇室环境记录与采收台账」种子项目（非库存 / 电商 / 医院 / 考勤）。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 后端 | Python 3.11 · Flask · SQLAlchemy 2 · Marshmallow · Flask-JWT-Extended · passlib(bcrypt) · gunicorn |
| 前端 | SolidJS · Vite · TypeScript · @solidjs/router |
| 数据库 | MySQL 8（协议兼容原 MariaDB 设计） |
| 部署 | docker-compose · 前端 Nginx 反代 `/api` |

## 端口与账号

| 服务 | 端口 |
| --- | --- |
| 前端 | **3800** |
| 后端 API | **8800** |
| MySQL | **3310** |

| 用户名 | 密码 | 角色 |
| --- | --- | --- |
| `admin` | `123456` | admin（场长） |
| `fruiter` | `123456` | fruiter（出菇员） |

数据库：`mushroomshed` / `mushroomshed`，库名 `mushroomshed`。JWT 密钥环境变量 **`JWT_SECRET`**。

## 一键启动

```bash
cd MushroomShed-01
docker compose up --build
```

启动后访问：

- 前端：http://localhost:3800
- 后端健康检查：http://localhost:8800/api/health

后端 entrypoint 流程：等待 MySQL 就绪 → `create_all` 建表 → seed 初始数据 → 启动 gunicorn。

## 功能模块

1. **Auth**：JWT 登录（OAuth2 表单或 JSON），`/api/auth/login`、`/api/auth/me`，`Authorization: Bearer`
2. **Shed 菇房**：`name`、`location`、`notes`
3. **Room 出菇室**：`shedId`、`roomCode`、`species`、`capacityBags`、`status(fruiting|idle|sanitize)`；同菇房 `roomCode` 唯一
4. **ClimateLog 环境记录**：`roomId`、`recordedAt`、`tempC`、`humidityPct`、`co2Ppm`、`notes`；`humidityPct ∈ [1,100]`，否则 **400**
5. **FlushHarvest 采收**：`roomId`、`harvestedAt`、`flushNo(≥1)`、`weightKg`、`grade(A|B|C)`、`operatorName`；`weightKg > 0`，否则 **400**
   - `grade` 在采收记录写下后即**冻结**，任何改判都不覆盖原等级。
6. **GradeAppeal 改判**：`harvestId`、`nextGrade(A|B|C)`、`reason`、`appealedAt`；同一潮次可挂多笔，只追加、不改写原 `grade`
   - `nextGrade` 只接受 `A/B/C`，且**不能等于当前有效等级**，否则 **400**
   - `reason` 去掉首尾空白后**至少 6 个字**，否则 **400**
   - **有效等级（effectiveGrade）选取规则**：
     1. 该采收没有任何改判时，有效等级就是原 `grade`；
     2. 有改判时，取 `appealedAt` **最晚**的一笔的 `nextGrade`；
     3. `appealedAt` 时刻相同，则取 `id` **更大**者。
   - 列表与单条采收均返回 `originalGrade`、`effectiveGrade`、`appealCount` 以及全部 `appeals`，两处 `effectiveGrade` 必相同。
7. **Grade mix 汇总**：`GET /api/flush-harvests/grade-mix` 按**有效等级**汇总 `weightKg`（可带 `?roomId=`）。它与列表各自按有效等级相加的结果一致，相差不超过 **0.001 kg**。
8. **Dashboard**：`shedTotal`、`fruitingRoomCount`、`climateLast24h`、`harvestKgLast7d`

各实体 API：采收 `GET/POST /api/flush-harvests`、`GET /api/flush-harvests/{id}`、`DELETE` 按 ID 删除；改判 `POST /api/flush-harvests/{id}/appeals`；汇总 `GET /api/flush-harvests/grade-mix`。其余实体为 `GET/POST` 列表与创建、`DELETE` 按 ID 删除。

## 前端页面

Login · Dashboard · Sheds · Rooms · ClimateLogs · FlushHarvests（侧边栏布局）

## 本地开发（可选）

```bash
# 数据库（或用 compose 只起 db）
docker compose up -d db

# 后端
cd backend
pip install -r requirements.txt
set DATABASE_URL=mysql+pymysql://mushroomshed:mushroomshed@localhost:3310/mushroomshed
set JWT_SECRET=local-dev-secret
python -c "from app.database import Base, engine; from app import models; Base.metadata.create_all(bind=engine)"
python -c "from app.seed import seed; seed()"
gunicorn wsgi:app --bind 0.0.0.0:8800 --reload

# 前端
cd frontend
npm install
npm run dev
```

## 目录结构

```
MushroomShed-01/
├── docker-compose.yml
├── README.md
├── .gitignore
├── backend/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── requirements.txt
│   ├── wsgi.py
│   └── app/
│       ├── __init__.py
│       ├── config.py
│       ├── database.py
│       ├── auth.py
│       ├── seed.py
│       ├── utils.py
│       ├── models/
│       ├── schemas/
│       └── routes/
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── pages/
        ├── components/
        └── api/
```
