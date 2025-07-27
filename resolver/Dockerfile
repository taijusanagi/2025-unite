# Step 1: Build Stage
FROM node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files and install dependencies
COPY package.json package-lock.json ./
RUN npm install

# Copy TypeScript files and config
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript -> JavaScript
RUN npm run build

# Step 2: Production Image
FROM node:22-alpine

WORKDIR /app

# Copy only built code and minimal necessary files
COPY --from=builder /app/dist ./dist
COPY package.json package-lock.json ./

# Install production-only dependencies
RUN npm install --omit=dev

# Expose Cloud Run-compatible port
EXPOSE 8080

# Start app
CMD ["node", "dist/index.js"]
