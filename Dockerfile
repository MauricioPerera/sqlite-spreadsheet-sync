# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies needed for both frontend and backend
# (Installing node-gyp dependencies for sqlite3 if needed, alpine usually needs python3 and make/g++)
RUN apk add --no-cache python3 make g++

# Copy package files for root
COPY package.json package-lock.json ./
RUN npm ci

# Copy package files for frontend
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN cd frontend && npm ci

# Copy the rest of the source code
COPY . .

# Build the frontend (Vite PWA)
RUN cd frontend && npm run build

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

# Only need the built artifacts and backend code
COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/server.js /app/database.js /app/mcp.js ./
COPY --from=builder /app/frontend/dist ./frontend/dist

# Set up environment variables for paths to point to a volume
ENV DB_PATH=/data/data.db
ENV UPLOADS_DIR=/data/uploads/
ENV PORT=3001
ENV NODE_ENV=production

# Ensure the volume directory exists and set permissions
RUN mkdir -p /data/uploads && chown -R node:node /data

EXPOSE 3001

# Run as non-root user for better security
USER node

CMD ["node", "server.js"]
