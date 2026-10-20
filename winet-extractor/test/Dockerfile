# Build the application image first, then add only the test fixture dependency.
ARG APP_IMAGE=winet-extractor:test
FROM ${APP_IMAGE}
RUN apk add --no-cache openssl
ENTRYPOINT []
CMD ["npm", "test"]
