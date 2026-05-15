import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@doomwire/db', '@doomwire/shared'],
};

export default config;
