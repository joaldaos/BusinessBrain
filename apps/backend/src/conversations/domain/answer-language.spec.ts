import {
  answerLanguageDirective,
  noKnowledgeAnswerIn,
} from './answer-language';

describe('en qué idioma responde BusinessBrain', () => {
  describe('la instrucción que viaja al modelo', () => {
    it('CRÍTICO: nombra el idioma de quien pregunta', () => {
      expect(answerLanguageDirective('en')).toContain('English');
      expect(answerLanguageDirective('es')).toContain('español');
    });

    it('CRÍTICO: dice que responda en ese idioma AUNQUE los documentos estén en otro', () => {
      // Es el escenario normal de una PYME española con facturas de proveedor en inglés. Sin
      // esta frase, el modelo tiende a contestar en el idioma del material que se le pasa.
      for (const locale of ['es', 'en'] as const) {
        expect(answerLanguageDirective(locale)).toMatch(
          /aunque los documentos estén en otro idioma/i,
        );
      }
    });

    it('la orden se repite en el propio idioma destino', () => {
      // Un modelo que va a responder en inglés obedece mejor una instrucción en inglés, y
      // repetirla no cuesta nada.
      expect(answerLanguageDirective('en')).toContain(
        'Write your answer in English',
      );
      expect(answerLanguageDirective('es')).toContain('Responde en español');
    });

    it('CRÍTICO: prohíbe traducir lo que se cita', () => {
      // Un fragmento traducido dentro de una respuesta deja de ser evidencia: quien lo lee no
      // puede ir al documento y encontrarlo. Y una cifra mal traducida convierte una
      // respuesta correcta en una decisión equivocada.
      const directiva = answerLanguageDirective('en');

      expect(directiva).toMatch(/NO TRADUZCAS/);
      expect(directiva).toMatch(/nombres propios/i);
      expect(directiva).toMatch(/cifras/i);
      expect(directiva).toMatch(/documento original/i);
    });
  });

  describe('cuando no hay nada sobre lo que responder', () => {
    it('la frase también está en cada idioma', () => {
      // No la escribe el modelo —ni se le llega a llamar— así que si no estuviera traducida,
      // un usuario inglés recibiría la única respuesta en castellano del producto.
      expect(noKnowledgeAnswerIn('es')).toMatch(/conocimiento indexado/i);
      expect(noKnowledgeAnswerIn('en')).toMatch(/indexed knowledge/i);
    });

    it('no se cuela castellano en la respuesta inglesa', () => {
      expect(noKnowledgeAnswerIn('en')).not.toMatch(/[áéíóúñ¿¡]/);
    });
  });
});
