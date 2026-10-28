// Adaptador de Claude: único archivo que conoce el SDK de Anthropic. La clave sale del ENTORNO DEL SERVIDOR
// (ANTHROPIC_API_KEY, o un perfil de `ant auth login`); nunca se escribe en el código ni se manda al navegador.
import Anthropic from '@anthropic-ai/sdk';

export function crearProveedorClaude({ cliente = new Anthropic() } = {}) {
  return {
    /* Devuelve eventos { tipo: 'texto', texto } y al final { tipo: 'fin', stop_reason, usage }. */
    async *transmitir(pedido, { senal } = {}) {
      const stream = cliente.beta.messages.stream(pedido, { signal: senal });
      for await (const ev of stream) {
        if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield { tipo: 'texto', texto: ev.delta.text };
      }
      const final = await stream.finalMessage();
      yield { tipo: 'fin', stop_reason: final.stop_reason, usage: final.usage };
    },
  };
}
