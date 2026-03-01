import { readFileSync } from 'fs';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.KK_DB_HOST || 'localhost',
  port: parseInt(process.env.KK_DB_PORT || '5432', 10),
  username: process.env.KK_DB_USERNAME,
  password: process.env.KK_DB_PASSWORD,
  database: process.env.KK_DB_DATABASE,
  ssl:
    process.env.KK_DB_SSL === 'true'
      ? {
          rejectUnauthorized: true,
          ca: readFileSync(
            process.env.KK_DB_SSL_CA || '/certs/postgres/ca.crt',
            'utf8',
          ),
        }
      : false,
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: false,
});
