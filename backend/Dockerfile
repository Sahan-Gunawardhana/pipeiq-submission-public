FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1
ENV RISK_API_PYTHON=/opt/venv/bin/python
ENV RISK_API_BASE=http://127.0.0.1:8000

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv python3-pip \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/backend/requirements.txt
RUN python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r /app/backend/requirements.txt

COPY package*.json /app/backend/
WORKDIR /app/backend
RUN npm ci --omit=dev

COPY . /app/backend

WORKDIR /app/backend
EXPOSE 4000

CMD ["npm", "start"]
