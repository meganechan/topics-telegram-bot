# Deployment Guide - Coolify

## Prerequisites

- Coolify server
- Domain name with SSL

## Deploy to Coolify

### Option 1: App + MongoDB Bundle (docker-compose.yml)

1. **Create New Resource** → **Docker Compose**
2. **Git Repository**: เลือก repo นี้
3. **Docker Compose Location**: `docker-compose.yml`
4. **Environment Variables**:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_WEBHOOK_URL=https://your-domain.com
   API_KEY_SECRET=your_secret_key
   ```
5. **Deploy**

### Option 2: App Only (ใช้ MongoDB จาก Coolify)

1. **สร้าง MongoDB Service ก่อน**:
   - New Resource → Database → MongoDB
   - จำ connection string ไว้

2. **สร้าง App**:
   - New Resource → Docker Compose หรือ Dockerfile
   - Git Repository: เลือก repo นี้
3. **Environment Variables**:

   ```
   NODE_ENV=production
   PORT=3000
   MONGODB_URI=mongodb://mongodb:27017/topics-telegram-bot
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_WEBHOOK_URL=https://your-domain.com
   API_KEY_SECRET=your_secret_key
   LOG_LEVEL=info
   ```

4. **Network**: เชื่อม App กับ MongoDB ใน network เดียวกัน

5. **Domain**: ตั้งค่า domain ใน Coolify

6. **Deploy**

## Environment Variables

| Variable               | Required | Description                           |
| ---------------------- | -------- | ------------------------------------- |
| `MONGODB_URI`          | ✅       | MongoDB connection string             |
| `TELEGRAM_BOT_TOKEN`   | ✅       | Telegram Bot Token จาก @BotFather     |
| `TELEGRAM_WEBHOOK_URL` | ✅       | URL ของ app (https://your-domain.com) |
| `API_KEY_SECRET`       | ✅       | Secret key สำหรับ API keys            |
| `PORT`                 | ❌       | Port (default: 3000)                  |
| `LOG_LEVEL`            | ❌       | Log level: debug, info, warn, error   |
| `MAX_FILE_SIZE`        | ❌       | Max upload size (default: 50MB)       |

## After Deployment

### 1. Create First API Key

ต้องสร้าง API key ผ่าน MongoDB โดยตรงครั้งแรก:

```javascript
// Connect to MongoDB และรัน:
db.apikeys.insertOne({
  key: "tk_your_admin_key_here",
  name: "Admin Key",
  scopes: ["admin", "read", "write"],
  isActive: true,
  createdAt: new Date(),
});
```

### 2. Test API

```bash
curl -X GET https://your-domain.com/api/v1/groups \
  -H "X-API-Key: tk_your_admin_key_here"
```

### 3. Access Swagger Docs

```
https://your-domain.com/api/docs
```

## Health Check

```
GET /webhook/telegram
```

## Troubleshooting

### App ไม่ start

- ตรวจสอบ MONGODB_URI ว่าเชื่อมต่อได้
- ดู logs ใน Coolify

### Webhook ไม่ทำงาน

- ตรวจสอบ TELEGRAM_WEBHOOK_URL ว่าถูกต้อง
- Domain ต้องเป็น HTTPS
- ตรวจสอบ firewall/port

### MongoDB connection failed

- ตรวจสอบว่า MongoDB service รันอยู่
- ตรวจสอบ network connectivity
