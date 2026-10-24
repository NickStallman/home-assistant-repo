import * as http from 'http';
import * as https from 'https';
import Winston from 'winston';
import {Properties} from './types/Properties';

type ReturnProperties = {
  properties: Properties;
  forceSsl: boolean;
};

export function getProperties(
  logger: Winston.Logger,
  host: string,
  lang: string,
  ssl: boolean
): Promise<ReturnProperties> {
  return new Promise((resolve, reject) => {
    const url = `${ssl ? 'https' : 'http'}://${host}/i18n/${lang}.properties`;

    // Current WiNet firmware only answers over HTTPS. Plain HTTP may be
    // refused, time out, or answer with something that isn't the file.
    const fallback = (err: Error) => {
      if (!ssl) {
        logger.warn(
          `Plain HTTP did not serve the WiNet language file (${err.message}). ` +
            'Retrying over HTTPS'
        );
        getProperties(logger, host, lang, true).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    };

    const request = () => {
      const options = ssl ? {rejectUnauthorized: false} : {};
      (ssl ? https : http)
        .get(url, options, res => {
          if (res.statusCode !== 200) {
            res.resume();
            fallback(new Error(`HTTP ${res.statusCode}`));
            return;
          }

          let data = '';

          res.on('data', chunk => {
            data += chunk;
          });

          res.on('error', fallback);

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
        .on('error', fallback)
        .setTimeout(10000, function (this: http.ClientRequest) {
          this.destroy(new Error('timed out'));
        });
    };

    request();
  });
}
