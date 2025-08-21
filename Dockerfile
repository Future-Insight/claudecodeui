# Multi-stage build for Claude Code UI
FROM node:18-alpine AS builder

# Install dependencies needed for native modules
RUN apk add --no-cache python3 make g++ sqlite-dev

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    sqlite \
    git \
    openssh-client \
    curl \
    bash \
    python3 \
    make \
    g++ \
    sqlite-dev

# Create app user
RUN addgroup -g 1001 -S claude && \
    adduser -S claude -u 1001

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server

# Create necessary directories and set permissions
RUN mkdir -p /app/data/auth /app/data/claude /app/data/projects && \
    chown -R claude:claude /app

# Switch to non-root user
USER claude

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3001/api/auth/status || exit 1

# Start the application
CMD ["node", "server/index.js"]