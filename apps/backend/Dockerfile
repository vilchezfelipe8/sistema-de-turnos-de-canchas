FROM node:18-bullseye-slim AS build
WORKDIR /usr/src/app
COPY package.json package-lock.json* tsconfig.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-bullseye-slim
WORKDIR /usr/src/app
COPY --from=build /usr/src/app/package.json ./
COPY --from=build /usr/src/app/node_modules ./node_modules
COPY --from=build /usr/src/app/dist ./dist
COPY prisma ./prisma
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/index.js"]
