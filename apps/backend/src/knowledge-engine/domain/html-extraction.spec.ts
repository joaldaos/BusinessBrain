import { extractFromHtml, isTextualContentType } from './html-extraction';

describe('extractFromHtml', () => {
  it('saca el título y el texto legible', () => {
    const page = extractFromHtml(`
      <html>
        <head><title>Política de descuentos</title></head>
        <body><p>Los descuentos superan el margen objetivo.</p></body>
      </html>
    `);

    expect(page.title).toBe('Política de descuentos');
    expect(page.text).toBe('Los descuentos superan el margen objetivo.');
  });

  describe('lo que NUNCA es contenido se descarta', () => {
    it('scripts y estilos no llegan al texto', () => {
      // Si llegaran, entrarían en los embeddings y en el cálculo de similitud: dos páginas
      // distintas del mismo sitio parecerían el mismo documento por compartir plantilla.
      const page = extractFromHtml(`
        <html><body>
          <style>.a{color:red}</style>
          <script>alert('hola')</script>
          <p>Contenido real.</p>
        </body></html>
      `);

      expect(page.text).toBe('Contenido real.');
      expect(page.text).not.toContain('alert');
      expect(page.text).not.toContain('color');
    });

    it('menús y pies de página tampoco', () => {
      const page = extractFromHtml(`
        <body>
          <nav><a href="/">Inicio</a><a href="/precios">Precios</a></nav>
          <p>El margen comercial cayó un 4 %.</p>
          <footer>Aviso legal · Cookies</footer>
        </body>
      `);

      expect(page.text).toBe('El margen comercial cayó un 4 %.');
    });

    it('los comentarios HTML no son contenido', () => {
      const page = extractFromHtml('<p>Visible</p><!-- secreto interno -->');
      expect(page.text).not.toContain('secreto');
    });
  });

  it('conserva la ESTRUCTURA en saltos de línea', () => {
    // El troceado posterior se apoya en ella; aplanarlo todo a una línea la destruiría.
    const page = extractFromHtml(
      '<h2>Resumen</h2><p>Primer punto.</p><p>Segundo punto.</p>',
    );

    expect(page.text).toBe('Resumen\nPrimer punto.\nSegundo punto.');
  });

  it('decodifica las entidades más frecuentes', () => {
    const page = extractFromHtml(
      '<p>Ventas &amp; Marketing&nbsp;&mdash; &quot;objetivo&quot; &#60;2026&#62;</p>',
    );

    expect(page.text).toContain('Ventas & Marketing');
    expect(page.text).toContain('"objetivo"');
    expect(page.text).toContain('<2026>');
  });

  it('sin <title> recurre al primer encabezado', () => {
    const page = extractFromHtml('<body><h1>Informe anual</h1><p>x</p></body>');
    expect(page.title).toBe('Informe anual');
  });

  it('sin título ni encabezado no inventa uno', () => {
    expect(extractFromHtml('<p>Solo texto</p>').title).toBeNull();
  });

  it('un documento vacío no rompe nada', () => {
    expect(extractFromHtml('')).toEqual({ title: null, text: '' });
  });

  it('texto sin marcado se devuelve tal cual', () => {
    expect(extractFromHtml('Una nota suelta.').text).toBe('Una nota suelta.');
  });
});

describe('isTextualContentType', () => {
  it.each([
    'text/html',
    'text/html; charset=utf-8',
    'text/plain',
    'application/xhtml+xml',
    'application/json',
  ])('admite %s', (type) => {
    expect(isTextualContentType(type)).toBe(true);
  });

  it.each(['application/pdf', 'image/png', 'application/octet-stream'])(
    'rechaza %s',
    (type) => {
      expect(isTextualContentType(type)).toBe(false);
    },
  );

  it('sin tipo declarado NO se procesa', () => {
    // Fail-closed: procesar bytes desconocidos como si fueran texto produce basura indexada.
    expect(isTextualContentType(null)).toBe(false);
  });
});
