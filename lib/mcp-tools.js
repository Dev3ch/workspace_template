/**
 * mcp-tools.js
 * Ayuda al usuario a seleccionar integraciones MCP y genera
 * la configuración mcpServers para .claude/settings.json.
 */

import chalk from 'chalk';
import { checkbox } from '@inquirer/prompts';

// ──────────────────────────────────────────────────────────────
// Catálogo de servidores MCP disponibles
// ──────────────────────────────────────────────────────────────

const MCP_CATALOG = [
  {
    value: 'none',
    name: 'Ninguna por ahora',
    description: '',
    config: null,
    envNote: null,
  },
  {
    value: 'notion',
    name: 'Notion — documentación del proyecto',
    description: 'Leer y escribir páginas y bases de datos de Notion desde Claude.',
    config: {
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-server-notion'],
    },
    envNote: 'Requiere NOTION_API_KEY — obtener en: https://www.notion.so/my-integrations',
  },
  {
    value: 'linear',
    name: 'Linear — tracking de issues (alternativa a GitHub Issues)',
    description: 'Crear, leer y actualizar issues y proyectos de Linear.',
    config: {
      command: 'npx',
      args: ['-y', '@linear/mcp-server'],
    },
    envNote: 'Requiere LINEAR_API_KEY — obtener en: https://linear.app/settings/api',
  },
  {
    value: 'slack',
    name: 'Slack — notificaciones',
    description: 'Enviar mensajes a canales de Slack desde Claude.',
    config: {
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-server-slack'],
    },
    envNote: 'Requiere SLACK_BOT_TOKEN y SLACK_TEAM_ID — obtener en: https://api.slack.com/apps',
  },
  {
    value: 'sentry',
    name: 'Sentry — monitoreo de errores',
    description: 'Consultar issues y eventos de Sentry para depurar errores.',
    config: {
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-server-sentry'],
    },
    envNote: 'Requiere SENTRY_AUTH_TOKEN — obtener en: https://sentry.io/settings/account/api/auth-tokens/',
  },
  {
    value: 'postgres',
    name: 'Postgres — acceso directo a DB desde Claude',
    description: 'Ejecutar queries SQL de lectura directamente en la base de datos.',
    config: {
      command: 'npx',
      args: ['-y', '@anthropic-ai/mcp-server-postgres'],
    },
    envNote: 'Requiere DATABASE_URL — ejemplo: postgresql://user:pass@localhost:5432/dbname\n  ⚠  Solo usar en entornos de desarrollo/staging, nunca producción.',
  },
  {
    value: 'context7',
    name: 'Context7 — docs actualizadas de SDKs/frameworks en el prompt',
    description: 'Inyecta documentación vigente de librerías en cada consulta, reduciendo alucinaciones.',
    config: {
      command: 'npx',
      args: ['-y', '@upstash/context7-mcp'],
    },
    envNote: 'Sin credenciales requeridas. Setup opcional con: npx ctx7 setup',
  },
  {
    value: 'n8n',
    name: 'n8n — crear y gestionar workflows N8N desde Claude',
    description: 'Generar automatizaciones n8n (email, Slack, integraciones) sin salir del editor.',
    config: {
      command: 'npx',
      args: ['-y', 'n8n-mcp'],
    },
    envNote: 'Requiere N8N_API_KEY y N8N_BASE_URL — obtener en tu instancia n8n: Settings → API.',
  },
];

// ──────────────────────────────────────────────────────────────
// Pregunta al usuario
// ──────────────────────────────────────────────────────────────

/**
 * Muestra el menú de integraciones MCP y devuelve la configuración seleccionada.
 *
 * @returns {{ mcpServers: Record<string, object> } | null}
 *   Objeto listo para mergear en .claude/settings.json, o null si no seleccionó nada.
 */
export async function askMcpIntegrations() {
  console.log(chalk.bold.cyan('\n══════ Integraciones MCP (opcional) ══════\n'));
  console.log(chalk.gray('MCP (Model Context Protocol) permite a Claude conectarse con herramientas externas.'));
  console.log(chalk.gray('Selecciona las integraciones que usa tu proyecto:\n'));

  const choices = MCP_CATALOG.map((item) => ({
    name: item.name,
    value: item.value,
    checked: false,
  }));

  const selected = await checkbox({
    message: '¿Tu proyecto usa alguna de estas integraciones?',
    choices,
  });

  // Si seleccionó "none" o nada, salir
  if (selected.length === 0 || selected.includes('none')) {
    console.log(chalk.gray('\nSin integraciones MCP — puedes agregarlas después en .claude/settings.json\n'));
    return null;
  }

  const mcpServers = {};
  const selectedTools = MCP_CATALOG.filter(
    (item) => selected.includes(item.value) && item.value !== 'none' && item.config !== null
  );

  for (const tool of selectedTools) {
    mcpServers[tool.value] = {
      ...tool.config,
      note: tool.envNote ?? '',
    };
  }

  // Mostrar notas de variables de entorno
  console.log(chalk.bold.yellow('\n⚠  Variables de entorno necesarias:\n'));
  for (const tool of selectedTools) {
    if (tool.envNote) {
      console.log(chalk.cyan(`  ${tool.name}:`));
      for (const line of tool.envNote.split('\n')) {
        console.log(chalk.gray(`    ${line}`));
      }
      console.log('');
    }
  }

  return { mcpServers };
}

// ──────────────────────────────────────────────────────────────
// Helpers para settings.json
// ──────────────────────────────────────────────────────────────

/**
 * Mergea la configuración MCP en un objeto settings existente.
 * @param {object} settings - objeto settings actual (puede estar vacío)
 * @param {{ mcpServers: object } | null} mcpConfig
 * @returns {object} settings actualizado
 */
export function mergeMcpConfig(settings, mcpConfig) {
  if (!mcpConfig) return settings;
  return {
    ...settings,
    mcpServers: {
      ...(settings.mcpServers ?? {}),
      ...mcpConfig.mcpServers,
    },
  };
}
