export const logger = {
    info: (...args: any[]) => console.log(JSON.stringify({ level: 'info', msg: args })),
    warn: (...args: any[]) => console.warn(JSON.stringify({ level: 'warn', msg: args })),
    error: (...args: any[]) => console.error(JSON.stringify({ level: 'error', msg: args }))
};

