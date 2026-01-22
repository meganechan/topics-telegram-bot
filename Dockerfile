# Build stage
FROM node:20-alpine AS builder

# Force install all dependencies regardless of NODE_ENV
ENV NODE_ENV=development

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci --include=dev

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install wget for healthcheck and create non-root user
RUN apk add --no-cache wget && \
    addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Copy package files
COPY package*.json ./

# Install production dependencies only
ENV NODE_ENV=production
RUN npm ci --omit=dev && npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist

# Create uploads directory
RUN mkdir -p ./uploads && chown -R nestjs:nodejs ./uploads

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 3000

# Health check - increased start period for MongoDB connection
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/webhook/telegram || exit 1

# Start the application
CMD ["node", "dist/main.js"]
