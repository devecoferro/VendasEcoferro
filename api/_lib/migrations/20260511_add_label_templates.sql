-- Migration: 20260511_add_label_templates
-- Tabela de templates de etiqueta por tenant (profile_id).
-- Cada tenant pode ter múltiplos templates (ex: "Padrão", "Compacto", "Fantom").
-- O template define o layout JSON com campos, posições, fontes e dimensões.
--
-- Estrutura do campo `layout_json`:
-- {
--   "card_width_mm": 194,
--   "card_height_mm": 53,
--   "fields": [
--     {
--       "id": "sku",
--       "type": "text",
--       "label": "SKU",
--       "source": "item.sku",
--       "x": 45, "y": 6, "font_size": 10, "font_weight": "bold",
--       "visible": true
--     },
--     {
--       "id": "product_image",
--       "type": "image",
--       "source": "item.productImageUrl",
--       "x": 8, "y": 13, "width": 31, "height": 32,
--       "visible": true
--     },
--     {
--       "id": "logo",
--       "type": "logo",
--       "source": "tenant.logo_url",
--       "x": 75, "y": 3, "width": 18, "height": 8,
--       "visible": true
--     }
--   ],
--   "border_color": "#f97316",
--   "border_radius_mm": 2.5,
--   "border_width_mm": 0.7
-- }
CREATE TABLE IF NOT EXISTS label_templates (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id      INTEGER NOT NULL
                    REFERENCES app_user_profiles(id) ON DELETE CASCADE,
  name            TEXT    NOT NULL DEFAULT 'Padrão',
  is_default      INTEGER NOT NULL DEFAULT 0,
  layout_json     TEXT    NOT NULL DEFAULT '{}',
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_label_templates_profile_id
  ON label_templates(profile_id);
