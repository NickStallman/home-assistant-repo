# Multi-arch image (amd64, aarch64). BUILD_FROM only needs to be passed to
# build from a different base, e.g. standalone on a 32-bit system.
ARG BUILD_FROM=ghcr.io/home-assistant/base:3.22
FROM ${BUILD_FROM}

USER root

# Create app directory
WORKDIR /usr/src/app

# Install Node.js
RUN apk add --no-cache nodejs npm tzdata

# Bundle app source
COPY . /usr/src/app

# Install tsc globally
RUN npm install -g typescript ts-node

# Install app dependencies
RUN npm install

# Build to Javascript
RUN npm run compile

RUN chmod a+x /usr/src/app/run.sh

# Start the app
CMD [ "/usr/src/app/run.sh" ]
