import * as http from 'http';
import {Properties} from './types/Properties';

export function getProperties(host: string): Promise<Properties> {
  return new Promise((resolve, reject) => {
    http.get(`http://${host}/i18n/en_US.properties`, res => {
      let data = '';

      res.on('data', chunk => {
        data += chunk;
      });

      res.on('error', err => {
        reject(err);
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

        resolve(properties);
      });
    });
  });
}
