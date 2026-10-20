import * as http from 'http';
import * as https from 'https';
import Winston from 'winston';
import {WinetTls} from './winetTls';
import {Properties} from './types/Properties';

type ReturnProperties = {
  properties: Properties;
  forceSsl: boolean;
};

export function getProperties(
  logger: Winston.Logger,
  host: string,
  lang: string,
  ssl: boolean,
  tlsPolicy = new WinetTls()
): Promise<ReturnProperties> {
  ssl = ssl || tlsPolicy.required;
  return new Promise((resolve, reject) => {
    const url = `${ssl ? 'https' : 'http'}://${host}/i18n/${lang}.properties`;

    const request = () => {
      const options = ssl ? {agent: tlsPolicy.agent} : {};
      (ssl ? https : http)
        .get(url, options, res => {
          let data = '';

          res.on('data', chunk => {
            data += chunk;
          });

          res.on('error', err => {
            if (!ssl) {
              // Retry with ssl set to true
              getProperties(logger, host, lang, true, tlsPolicy)
                .then(resolve)
                .catch(reject);
            } else {
              reject(err);
            }
          });

          res.on('end', () => {
            const lines = data.split('\n');
            const properties: Properties = {};

            for (const line of lines) {
              const [key, value] = line.split('=', 2);
              if (key && value) {
                properties[key] = value;
              }
            }

            resolve({properties, forceSsl: ssl});
          });
        })
        .on('error', err => {
          if (!ssl) {
            logger.warn(
              'Newer Winet versions require SSL to be enabled. Retrying'
            );
            // Retry with ssl set to true
            getProperties(logger, host, lang, true, tlsPolicy)
              .then(resolve)
              .catch(reject);
          } else {
            reject(err);
          }
        });
    };

    request();
  });
}
