# Stage 1: Build
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install dependencies
RUN npm install
RUN cd client && npm install --legacy-peer-deps && cd ..

# Copy source code
COPY . .

# Build both server and client
RUN npm run build
RUN cd client && npm run build && cd ..

# Stage 2: Production
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm install --production

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/client/build ./client/build

# Copy package files for serving
COPY package*.json ./

# Create directory for temporary files
RUN mkdir -p /app/temp

# Create config directory and set it as a volume
RUN mkdir -p /app/config
VOLUME /app/config

# Expose port (only need 3001 since we're serving frontend from the same port)
EXPOSE 3001

# Set default config path to volume
ENV CONFIG_PATH=/app/config/config.yaml
ENV PORT=3001

# Start the application
CMD ["npm", "start"]
