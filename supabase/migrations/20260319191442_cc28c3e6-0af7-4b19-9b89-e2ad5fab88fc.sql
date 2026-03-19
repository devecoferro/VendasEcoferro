
-- Table for ML connected accounts
CREATE TABLE public.ml_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  seller_id TEXT NOT NULL UNIQUE,
  seller_nickname TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Table for synced orders
CREATE TABLE public.ml_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE,
  sale_number TEXT NOT NULL,
  sale_date TIMESTAMP WITH TIME ZONE NOT NULL,
  buyer_name TEXT,
  buyer_nickname TEXT,
  item_title TEXT,
  item_id TEXT,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  amount NUMERIC,
  order_status TEXT,
  shipping_id TEXT,
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ml_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_orders ENABLE ROW LEVEL SECURITY;

-- For now, allow all access (single-user system, no auth yet)
CREATE POLICY "Allow all on ml_connections" ON public.ml_connections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ml_orders" ON public.ml_orders FOR ALL USING (true) WITH CHECK (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_ml_connections_updated_at
  BEFORE UPDATE ON public.ml_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
