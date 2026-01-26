/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Suprimir el warning de react-datepicker sobre dependencias críticas
    config.module = {
      ...config.module,
      exprContextCritical: false,
      unknownContextCritical: false,
    };
    return config;
  },
};

module.exports = nextConfig;
