FROM docker.io/cloudflare/sandbox:0.12.3

COPY scaffold /opt/lodesta-site-scaffold
RUN cd /opt/lodesta-site-scaffold \
    && npm ci --ignore-scripts --no-audit --no-fund \
    && chmod -R a+rX /opt/lodesta-site-scaffold

WORKDIR /workspace
