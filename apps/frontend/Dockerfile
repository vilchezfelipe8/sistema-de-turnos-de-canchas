FROM node:18-bullseye-slim AS deps
WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:18-bullseye-slim AS builder
WORKDIR /usr/src/app
COPY --from=deps /usr/src/app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:18-bullseye-slim
WORKDIR /usr/src/app
ENV NODE_ENV=production
COPY --from=builder /usr/src/app/.next ./.next
COPY --from=builder /usr/src/app/public ./public
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3000
CMD ["npm","start"]
