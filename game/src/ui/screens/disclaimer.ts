import { h } from '../dom';

/** Educational-simulation disclaimer shown on menu and intro screens. */
export function disclaimer(): HTMLElement {
  return h(
    'p',
    { class: 'disclaimer' },
    'Výuková simulace. Nejde o oficiální produkt společnosti Broadcom ani VMware, není s nimi spojena ' +
      'a nepoužívá jejich loga. Názvy produktů slouží pouze k označení simulované technologie.',
  );
}
