FROM docker.io/cloudflare/sandbox:0.12.7@sha256:6d741713aef266e8ae0831a5709c6f2d7b77b4952ac79b549f4f4e380af86fbe

# @cloudflare/sandbox executes commands through /bin/bash. A hosted 0.12.7
# rollout could not spawn that path even though the base package metadata said
# Bash was installed. Pin the base and force the required binary into our own
# image layer instead of trusting mutable upstream contents or package state.
RUN apt-get update \
    && apt-get install --reinstall -y --no-install-recommends bash \
    && test -x /bin/bash \
    && rm -rf /var/lib/apt/lists/*

COPY scaffold/package.json scaffold/package-lock.json /opt/lodesta-site-scaffold/
RUN cd /opt/lodesta-site-scaffold \
    && npm ci --ignore-scripts --no-audit --no-fund \
    && chmod -R a+rX /opt/lodesta-site-scaffold

COPY scaffold /opt/lodesta-site-scaffold

WORKDIR /workspace

EXPOSE 4173
