# Control Financiero Personal

App web para registrar ingresos y gastos, controlar el presupuesto mensual, detectar gastos hormiga y seguir metas de ahorro.

## Arquitectura

- **Base de datos:** Google Sheets (pestañas `Movimientos`, `Presupuesto`, `Ahorros`)
- **API:** Google Apps Script publicado como Web App (`backend/Code.gs`)
- **Frontend:** HTML + JavaScript ES6 (módulos) + Tailwind, en GitHub Pages

## Estructura

```
├── index.html        # Vistas: configuración y app
├── css/styles.css    # Componentes de UI
├── js/api.js         # Comunicación con Apps Script + configuración en localStorage
├── js/app.js         # Lógica de interfaz
└── backend/Code.gs   # Copia de respaldo del script (se despliega en Apps Script)
```

## Seguridad

La URL de la Web App y la `API_KEY` **no están en el repositorio**. La app las pide la primera vez y las guarda en el `localStorage` de ese navegador. "Desconectar" las borra.

## Desarrollo local

Abrir la carpeta en VS Code y usar la extensión **Live Server** (los módulos ES no funcionan abriendo el archivo con doble clic).
