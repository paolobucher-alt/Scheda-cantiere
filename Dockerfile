FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/data PORT=3000 COOKIE_SECURE=1
VOLUME /data
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server/index.js"]
