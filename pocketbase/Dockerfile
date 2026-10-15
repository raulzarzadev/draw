FROM alpine:3.23
ARG PB_VERSION=0.40.5
RUN apk add --no-cache ca-certificates unzip wget \
    && wget -q "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" -O /tmp/pb.zip \
    && echo "1dbea1b01eb3dfe64953513859d01e759c96650c4e3264fa4eecd54b769382e4  /tmp/pb.zip" | sha256sum -c - \
    && unzip /tmp/pb.zip pocketbase -d /pb \
    && rm /tmp/pb.zip
COPY migrations /pb/pb_migrations
COPY hooks /pb/pb_hooks
COPY start.sh /pb/start.sh
RUN chmod +x /pb/start.sh
EXPOSE 8090
CMD ["/pb/start.sh"]
