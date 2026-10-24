# Multi-arch image (amd64, aarch64). BUILD_FROM only needs to be passed to
# build from a different base, e.g. standalone on a 32-bit system.
ARG BUILD_FROM=ghcr.io/home-assistant/base:3.22

# Build stage: compile TypeScript with the dev dependencies
FROM ${BUILD_FROM} AS build
RUN apk add --no-cache nodejs npm
WORKDIR /usr/src/app
COPY package.json package-lock.json tsconfig.json ./
# prepare would run tsc before the sources are copied in
RUN npm ci --ignore-scripts
COPY src ./src
RUN npm run compile && npm prune --omit=dev

# Runtime stage: only the compiled code and production dependencies
FROM ${BUILD_FROM}
RUN apk add --no-cache nodejs tzdata
WORKDIR /usr/src/app
COPY --from=build /usr/src/app/build ./build
COPY --from=build /usr/src/app/node_modules ./node_modules
# config.yaml is read at startup for the version number
COPY config.yaml run.sh ./
RUN chmod a+x /usr/src/app/run.sh

CMD [ "/usr/src/app/run.sh" ]
