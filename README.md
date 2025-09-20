# Telegram Ticket Support System

ระบบ Telegram Bot สำหรับจัดการ Ticket Support ที่ใช้ Telegram Topics ในการสร้างพื้นที่สนทนาแยกกันสำหรับแต่ละ Ticket

## Features

- 🎫 สร้าง Ticket อัตโนมัติผ่าน Telegram Topics
- 👥 Mention External Users จากระบบภายนอก
- 🔄 Message Sync แบบ Real-time ระหว่าง Topics
- 📎 รองรับไฟล์แนบ (รูปภาพ, เอกสาร, วิดีโอ)
- 🔗 REST API สำหรับระบบภายนอก
- 🪝 Webhook System สำหรับ Event Integration

## Tech Stack

- **Backend**: NestJS + TypeScript
- **Database**: MongoDB
- **Bot Framework**: Telegraf
- **Container**: Docker/Podman

## Installation

### Prerequisites

- Node.js 18+
- MongoDB
- Telegram Bot Token

### Setup

1. Clone the repository
```bash
git clone <repository-url>
cd topics-telegram-bot
```

2. Install dependencies
```bash
npm install
```

3. Configure environment
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Start MongoDB (if not using Docker)
```bash
# Using Docker
docker run -d -p 27017:27017 --name mongodb mongo:7.0-jammy

# Or install MongoDB locally
```

5. Run the application
```bash
# Development
npm run start:dev

# Production
npm run build
npm run start:prod
```

### Using Docker

```bash
# Copy environment file
cp .env.example .env
# Edit .env with your values

# Start with Docker Compose
docker-compose up -d
```

## Configuration

Edit `.env` file:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_WEBHOOK_URL=https://yourdomain.com/webhook/telegram

# Database
MONGODB_URI=mongodb://localhost:27017/topics-telegram-bot

# Application
NODE_ENV=development
PORT=3000
API_KEY_SECRET=your_secret_key
```

## Usage

### Basic Commands

- `/start` - เริ่มใช้งาน Bot
- `/create_ticket <title> [description]` - สร้าง Ticket ใหม่
- `/close_ticket` - ปิด Ticket (ใช้ใน Topic)
- `/mention @username` - เชิญ External User

### Setup Bot in Group

1. เพิ่ม Bot เข้ากลุ่ม Telegram
2. ให้สิทธิ์ Admin กับ Bot:
   - จัดการข้อความ
   - สร้าง/แก้ไข Topics
   - ลบข้อความ
3. เปิดใช้งาน Topics ในกลุ่ม
4. ใช้คำสั่ง `/start` เพื่อลงทะเบียนกลุ่ม

## Development

### Project Structure

```
src/
├── modules/
│   ├── bot/           # Telegram Bot Logic
│   ├── ticket/        # Ticket Management
│   ├── users/         # User Management
│   ├── groups/        # Group Management
│   └── topics/        # Topics Management
├── config/            # Configuration Files
├── common/            # Shared Utilities
├── app.module.ts
└── main.ts
```

### Scripts

```bash
npm run start:dev      # Start in development mode
npm run build          # Build for production
npm run test           # Run tests
npm run lint           # Lint code
npm run format         # Format code
```

## Development Phases

- **Phase 1**: Core Infrastructure ✅ (Current)
- **Phase 2**: Basic Ticket Management
- **Phase 3**: External User Integration
- **Phase 4**: Attachment & Message Enhancement
- **Phase 5**: REST API Gateway
- **Phase 6**: Hook System & Monitoring

## License

MIT License