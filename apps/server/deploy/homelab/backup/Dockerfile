# Daily copies of the sync server's SQLite database, made with SQLite's own
# online backup, which is safe while the server is writing.
FROM alpine:3.22
RUN apk add --no-cache sqlite su-exec tzdata
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
ENTRYPOINT ["/usr/local/bin/backup.sh"]
