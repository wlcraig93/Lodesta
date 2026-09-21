FROM docker.io/cloudflare/sandbox:0.12.7@sha256:6d741713aef266e8ae0831a5709c6f2d7b77b4952ac79b549f4f4e380af86fbe

COPY scaffold/package.json scaffold/package-lock.json /opt/lodesta-site-scaffold/
RUN cd /opt/lodesta-site-scaffold \
    && npm ci --ignore-scripts --no-audit --no-fund \
    && chmod -R a+rX /opt/lodesta-site-scaffold

COPY scaffold /opt/lodesta-site-scaffold

WORKDIR /workspace

EXPOSE 4173
