ARG BUILD_FROM
FROM $BUILD_FROM

USER root

LABEL \
  io.hass.version="VERSION" \
  io.hass.type="addon" \
  io.hass.arch="armhf|aarch64|i386|amd64"

# Create app directory
WORKDIR /usr/src/app

# Install Node.js
RUN apk add --no-cache nodejs npm

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