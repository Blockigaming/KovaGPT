# syntax=docker/dockerfile:1.7
# Build with an approved Python 3.13+ slim image pinned by SHA-256. The deployed
# executor independently requires the final image's immutable digest.
ARG PYTHON_BASE_IMAGE=python:3.13-slim-bookworm@sha256:ed86c82274b3c69b52fb5820f358f0bd7df0b603332063cb5c6e32bd220c3e6e
FROM ${PYTHON_BASE_IMAGE}
WORKDIR /opt/kova
RUN test -x /usr/bin/wc && test -x /usr/bin/sort && test -x /usr/bin/uniq && test -x /usr/bin/head && test -x /usr/bin/tail && test -x /usr/bin/cut && test -x /usr/bin/sha256sum
COPY --chmod=0444 execute.py /opt/kova/execute.py
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/python3", "-I", "-B", "/opt/kova/execute.py"]
