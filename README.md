# 🎾 Sistema de Gestión de Turnos de Padel

Backend desarrollado para la gestión de reservas de canchas deportivas. Implementa una arquitectura en capas (**Controller, Service, Repository**), manejo de base de datos con **Prisma ORM**, y seguridad mediante autenticación **JWT**.

## 🚀 Tecnologías Utilizadas

* **Lenguaje:** TypeScript / Node.js
* **Framework:** Express
* **Base de Datos:** SQLite (Entorno de desarrollo) / PostgreSQL
* **ORM:** Prisma
* **Seguridad:** Bcrypt (Hashing) + JWT (Tokens)

---

## 🛠️ Instalación y Configuración

Sigue estos pasos para levantar el proyecto desde cero:

### 1. Instalar dependencias
```bash
npm install

2. Configurar la Base de Datos
Este comando crea las tablas y aplica las relaciones definidas en schema.prisma
npx prisma migrate dev --name init

3. Cargar Datos de Prueba (Seed)
Este comando limpia la base de datos y crea usuarios (Messi), canchas y actividades por defecto:
npx prisma db seed

4. Iniciar el Servidor
npm run dev

🧪 Usuarios de Prueba
El comando seed crea automáticamente este usuario para facilitar las pruebas:
Usuario: Lionel Messi
Email: lio@messi.com
Password: 123456
Rol: MEMBER

📡 Documentación de la API (Endpoints)
🔐 Autenticación (Auth)
Método	Endpoint	Descripción	Body (JSON)
POST	/api/auth/register	Registrar nuevo usuario	{ firstName, lastName, email, password, phoneNumber }
POST	/api/auth/login	Iniciar sesión y obtener Token	{ email, password }

🎾 Reservas (Bookings)
Método	Endpoint	Descripción	Body / Query
GET	/api/bookings/availability	(Público) Ver turnos libres	?date=2025-10-27&courtId=1
POST	/api/bookings	(Privado) Crear una reserva	{ userId, courtId, activityId, date, startTime }
POST	/api/bookings/cancel	(Privado) Cancelar una reserva	{ bookingId }
GET	/api/bookings/history/:id	(Privado) Historial del usuario	-
GET	/api/bookings/admin/schedule	(Privado) Grilla completa del día (Admin)	?date=2025-10-27

🏟️ Canchas (Courts)
POST	/api/courts	Crear nueva cancha	{ name, clubId, surface, isIndoor }
PUT	/api/courts/:id	Poner en mantenimiento	{ isUnderMaintenance: true }


🏛️ Arquitectura del Proyecto
El código está organizado siguiendo el patrón de Inyección de Dependencias:
/controllers: Manejan la petición HTTP (Request/Response) y validan datos.
/services: Contienen la lógica de negocio pura (Reglas, validaciones de horarios).
/repositories: Capa de acceso a datos, se comunica directamente con Prisma.
/middlewares: Interceptores para seguridad (Validación de Token JWT).
/entities: Definición de clases del dominio.