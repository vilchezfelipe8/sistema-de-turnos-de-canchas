// src/services/WhatsappService.ts
import { Client, LocalAuth } from 'whatsapp-web.js';

class WhatsappService {
    private client: Client | null = null;
    private isReady: boolean = false;
    private currentQR: string | null = null;
    private isDisabled: boolean;

    constructor() {
        // Verificar si WhatsApp está deshabilitado
        this.isDisabled = process.env.DISABLE_WHATSAPP === 'true' || process.env.DISABLE_WHATSAPP === '1';
        
        if (this.isDisabled) {
            console.log('⚠️ WhatsApp deshabilitado por variable de entorno DISABLE_WHATSAPP');
            return;
        }

        this.client = new Client({
            authStrategy: new LocalAuth(),
            
            
            puppeteer: {
                protocolTimeout: 300000, // 5 minutos para servidores lentos
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-software-rasterizer',
                    '--disable-extensions',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-renderer-backgrounding',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad',
                    '--disable-component-extensions-with-background-pages',
                    '--disable-default-apps',
                    '--disable-sync',
                    '--metrics-recording-only',
                    '--mute-audio',
                    '--no-default-browser-check',
                    '--no-pings',
                    '--use-mock-keychain',
                    '--single-process' // Útil para Railway
                ],
                headless: true,
                timeout: 300000 // 5 minutos
            }
        });

        // Guardar el QR
        this.client.on('qr', (qr) => {
            this.currentQR = qr;
            console.log('📱 Nuevo QR generado. Accede a /whatsapp/qr para verlo en el navegador');
        });

        // Cuando ya está conectado
        this.client.on('ready', () => {
            this.isReady = true;
            this.currentQR = null; // Limpiar QR cuando está listo
            console.log('✅ WhatsApp conectado y listo');
        });

        // Manejo de desconexión para evitar procesos zombies
        this.client.on('disconnected', (reason) => {
             this.isReady = false;
             this.currentQR = null;
             console.warn('⚠️ WhatsApp desconectado:', reason);
        });

        // Manejar errores de autenticación
        this.client.on('auth_failure', (msg) => {
            console.error('❌ Error de autenticación de WhatsApp:', msg);
            this.isReady = false;
        });

        this.client.initialize();

        // --- MANEJO DE CIERRE LIMPIO (IGUAL QUE ANTES) ---
        process.once('SIGUSR2', async () => {
            if (this.client) {
                try {
                    await this.client.destroy(); 
                } catch (e) {
                    console.error('No se pudo cerrar Chrome, forzando...', e);
                }
            }
            process.kill(process.pid, 'SIGUSR2'); 
        });

        process.on('SIGINT', async () => {
            if (this.client) {
                try {
                    await this.client.destroy();
                } catch (e) {
                    console.error('Error cerrando cliente:', e);
                }
            }
            process.exit(0);
        });
    }

    async sendMessage(phoneNumber: string, message: string, retries: number = 2): Promise<boolean> {
        // Si WhatsApp está deshabilitado, retornar false silenciosamente
        if (this.isDisabled || !this.client) {
            if (this.isDisabled) {
                console.log('📵 WhatsApp deshabilitado, mensaje no enviado');
            }
            return false;
        }

        if (!this.isReady) {
            console.warn('⚠️ WhatsApp no está listo, no se puede enviar mensaje');
            return false;
        }

        // Verificar que el cliente esté realmente conectado (con manejo de errores de frame)
        try {
            const state = await this.client.getState();
            if (state !== 'CONNECTED') {
                console.warn(`⚠️ WhatsApp no está conectado (estado: ${state}), no se puede enviar mensaje`);
                this.isReady = false;
                return false;
            }
        } catch (error: any) {
            const errorMsg = error?.message || String(error);
            // Si es un error de frame desconectado, marcar como no listo y no intentar enviar
            if (errorMsg.includes('detached Frame') || errorMsg.includes('Target closed')) {
                console.warn('⚠️ Frame desconectado al verificar estado, WhatsApp no disponible');
                this.isReady = false;
                return false;
            }
            console.warn('⚠️ No se pudo verificar el estado de WhatsApp:', errorMsg);
            // No marcar como no listo si es otro tipo de error, podría ser temporal
        }

        // Formatear el número (simple)
        // Asegúrate que phoneNumber venga como "549351..." sin el "+"
        const chatId = `${phoneNumber}@c.us`; 

        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                if (attempt > 0) {
                    console.log(`🔄 Reintentando enviar mensaje (intento ${attempt + 1}/${retries + 1})...`);
                    // Esperar un poco antes de reintentar
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    
                    // Verificar estado nuevamente antes de reintentar
                    try {
                        const state = await this.client.getState();
                        if (state !== 'CONNECTED') {
                            console.warn(`⚠️ WhatsApp desconectado durante reintento (estado: ${state})`);
                            this.isReady = false;
                            return false;
                        }
                    } catch (e: any) {
                        const errorMsg = e?.message || String(e);
                        // Si es error de frame, no reintentar
                        if (errorMsg.includes('detached Frame') || errorMsg.includes('Target closed')) {
                            console.warn('⚠️ Frame desconectado durante verificación de reintento');
                            this.isReady = false;
                            return false;
                        }
                        // Para otros errores, solo loguear pero continuar con el reintento
                        console.warn('⚠️ No se pudo verificar estado durante reintento, continuando...');
                    }
                }

                // Aumentar timeout para el envío de mensajes
                const timeoutPromise = new Promise<never>((_, reject) => 
                    setTimeout(() => reject(new Error('Timeout enviando mensaje')), 60000) // 60 segundos
                );
                
                await Promise.race([
                    this.client.sendMessage(chatId, message, {sendSeen: false}),
                    timeoutPromise
                ]);
                
                console.log(`✅ Mensaje enviado a ${phoneNumber}`);
                return true;
            } catch (error: any) {
                const errorMessage = error?.message || String(error);
                
                // Si es un error de frame desconectado o target closed, marcar como no listo
                if (errorMessage.includes('detached Frame') || 
                    errorMessage.includes('Target closed') ||
                    errorMessage.includes('Session closed')) {
                    console.warn('⚠️ Frame desconectado, marcando WhatsApp como no listo');
                    this.isReady = false;
                    
                    // Si es el último intento, no reintentar
                    if (attempt === retries) {
                        console.error('❌ Error enviando mensaje de WhatsApp después de todos los reintentos:', errorMessage);
                        return false;
                    }
                    continue; // Reintentar
                }
                
                // Para otros errores, loguear y retornar false
                if (attempt === retries) {
                    console.error('❌ Error enviando mensaje de WhatsApp:', errorMessage);
                    return false;
                }
            }
        }
        
        return false;
    }

    getQR(): string | null {
        if (this.isDisabled) return null;
        return this.currentQR;
    }

    getStatus(): { ready: boolean; hasQR: boolean; disabled: boolean } {
        return {
            ready: this.isReady && !this.isDisabled,
            hasQR: this.currentQR !== null && !this.isDisabled,
            disabled: this.isDisabled
        };
    }
}

export const whatsappService = new WhatsappService();