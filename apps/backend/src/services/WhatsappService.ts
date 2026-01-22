// src/services/WhatsappService.ts
import { Client, LocalAuth } from 'whatsapp-web.js';

class WhatsappService {
    private client: Client;
    private isReady: boolean = false;
    private currentQR: string | null = null;

    constructor() {
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
        this.client.on('disconnected', () => {
             this.isReady = false;
             this.currentQR = null;
        });

        this.client.initialize();

        // --- MANEJO DE CIERRE LIMPIO (IGUAL QUE ANTES) ---
        process.once('SIGUSR2', async () => {
            try {
                await this.client.destroy(); 
            } catch (e) {
                console.error('No se pudo cerrar Chrome, forzando...', e);
            }
            process.kill(process.pid, 'SIGUSR2'); 
        });

        process.on('SIGINT', async () => {
            try {
                await this.client.destroy();
            } catch (e) {
                console.error('Error cerrando cliente:', e);
            }
            process.exit(0);
        });
    }

    async sendMessage(phoneNumber: string, message: string) {
        if (!this.isReady) {
            console.warn('⚠️ WhatsApp no está listo, no se puede enviar mensaje');
            return;
        }

        // Formatear el número (simple)
        // Asegúrate que phoneNumber venga como "549351..." sin el "+"
        const chatId = `${phoneNumber}@c.us`; 

        try {
            // Aumentar timeout para el envío de mensajes
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Timeout enviando mensaje')), 60000) // 60 segundos
            );
            
            await Promise.race([
                this.client.sendMessage(chatId, message, {sendSeen: false}),
                timeoutPromise
            ]);
            
            console.log(`✅ Mensaje enviado a ${phoneNumber}`);
        } catch (error: any) {
            console.error('❌ Error enviando mensaje de WhatsApp:', error);
            // No lanzar el error para que no rompa el flujo de la aplicación
            // El mensaje simplemente no se enviará
        }
    }

    getQR(): string | null {
        return this.currentQR;
    }

    getStatus(): { ready: boolean; hasQR: boolean } {
        return {
            ready: this.isReady,
            hasQR: this.currentQR !== null
        };
    }
}

export const whatsappService = new WhatsappService();