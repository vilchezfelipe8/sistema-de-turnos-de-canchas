FROM node:18-bullseye-slim

RUN apt-get update && apt-get install -y \
  ca-certificates \
  fonts-liberation \
  wget \
  gnupg \
  libnss3 \
  libxss1 \
  libasound2 \
  libatk-bridge2.0-0 \
  libatk1.0-0 \
  libcups2 \
  libdbus-1-3 \
  libdrm2 \
  libgbm1 \
  libgtk-3-0 \
  libnspr4 \
  libx11-xcb1 \
  libxcomposite1 \
  libxdamage1 \
  libxrandr2 \
  xdg-utils \
  libu2f-udev \
  libvulkan1 \
  libx11-6 \
  libxext6 \
  libxfixes3 \
  libxrender1 \
  chromium \
  chromium-driver \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .

VOLUME ["/usr/src/app/session"]
ENV NODE_ENV=production
ENV CHROME_PATH=/usr/bin/chromium-browser
CMD ["node", "index.js"]
