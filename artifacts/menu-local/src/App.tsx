import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link, Route, Switch, useParams, Router as WouterRouter } from 'wouter';
import Cropper from 'cropperjs';
import 'cropperjs/dist/cropper.css';
import {
  ArrowLeft, ArrowRight, Check, Clock3, Copy, Edit3, ExternalLink, Heart, ImagePlus,
  LogOut, MapPin, MessageCircle, Minus, Package, Plus, ShoppingBag, ThumbsDown, ThumbsUp,
  Share2, Trash2, Truck, Utensils, X, ChartNoAxesColumnIncreasing, Settings2, Store, ClipboardList,
} from 'lucide-react';
import {
  useGetStorefront, useGetProduct, useReactToProduct, useListProductComments,
  useCreateProductComment, useCreateOrder, useGetAdminSession, useCreateAdminSession,
  useDeleteAdminSession, useGetAdminOverview, useUpdateStoreSettings, useUploadStoreImage,
  useCreateProduct, useUpdateProduct, useDeleteProduct, useCreateDeliveryZone,
  useUpdateDeliveryZone, useDeleteDeliveryZone, useUpdateOrderStatus,
  getGetProductQueryKey, getGetStorefrontQueryKey, getListProductCommentsQueryKey,
  getGetAdminOverviewQueryKey, getGetAdminSessionQueryKey,
} from '@workspace/api-client-react';
import type {
  Product, ProductComment, ProductDetail, AdminOverview, StoreSettings, OrderInput, StoreSettingsInput, ProductInput,
  DeliveryZoneInput, DeliveryZone, AdminOrder,
} from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
type CartLine = { product: Product; quantity: number };
type Cart = Record<number, CartLine>;
const money = (amount: number) => new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(amount);
const currentPrice = (p: Product) => p.offerPrice ?? p.price;
const CART_KEY = 'menu-local-cart';
const FOOD_PLACEHOLDER = `${import.meta.env.BASE_URL}food-placeholder.svg`;
async function copyProductLink(slug: string) {
  const url = new URL(`/p/${encodeURIComponent(slug)}`, window.location.origin).toString();
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(url);
    return;
  }
  const input = document.createElement('textarea');
  input.value = url;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.append(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('No se pudo copiar el enlace.');
}
const getCart = (): Cart => {
  try { return JSON.parse(localStorage.getItem(CART_KEY) || '{}') as Cart; } catch { return {}; }
};
function useCart() {
  const [cart, setCart] = useState<Cart>(getCart);
  useEffect(() => { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }, [cart]);
  const count = Object.values(cart).reduce((n, item) => n + item.quantity, 0);
  const total = Object.values(cart).reduce((n, item) => n + currentPrice(item.product) * item.quantity, 0);
  const add = (p: Product) => setCart(old => ({ ...old, [p.id]: { product: p, quantity: (old[p.id]?.quantity || 0) + 1 } }));
  const setQty = (p: Product, qty: number) => setCart(old => {
    const next = { ...old };
    if (qty < 1) delete next[p.id]; else next[p.id] = { product: p, quantity: qty };
    return next;
  });
  const clear = () => setCart({});
  return { cart, count, total, add, setQty, clear };
}
function currencyText(price: number) { return money(price); }
function FullPageMessage({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return <div className="shell texture grid place-items-center px-5"><div className="panel p-8 text-center max-w-md w-full">
    <span className="eyebrow text-muted-foreground">Menú Local</span><h1 className="serif text-3xl mt-3">{title}</h1>
    <p className="text-sm text-muted-foreground mt-2">{detail}</p>{retry && <button className="btn btn-primary mt-6" onClick={retry} data-testid="button-retry">Intentar de nuevo</button>}
  </div></div>;
}
function Brand({ name = 'Menú Local', logo, inverse = false }: { name?: string; logo?: string | null; inverse?: boolean }) {
  return <div className="flex items-center gap-3">
    {logo ? <img src={logo} alt="" className="w-10 h-10 object-cover rounded-full border border-border" /> : <span className={`w-10 h-10 rounded-full grid place-items-center ${inverse ? 'bg-white/10' : 'bg-primary text-primary-foreground'}`}><Utensils size={18}/></span>}
    <div><div className="serif text-lg leading-tight">{name}</div><div className="eyebrow opacity-60 text-[8px]">Sabor de aquí</div></div>
  </div>;
}
function ShopHeader({ store, cartCount }: { store: {storeName:string;logoUrl?:string|null; tagline?:string}; cartCount: number }) {
  return <header className="page-wrap flex items-center justify-between py-5">
    <Link href="/" className="no-underline text-inherit" data-testid="link-home"><Brand name={store.storeName} logo={store.logoUrl}/></Link>
    <div className="flex items-center gap-3">
      <span className="hidden sm:block text-xs text-muted-foreground">{store.tagline}</span>
      <Link href="/checkout" className="btn btn-primary !px-4 !py-2.5" data-testid="link-cart"><ShoppingBag size={16}/><span>Pedido</span>{cartCount > 0 && <b className="w-5 h-5 rounded-full bg-accent text-white text-[10px] grid place-items-center">{cartCount}</b>}</Link>
    </div>
  </header>;
}
function ProductCard({ product, add }: { product: Product; add: (p:Product)=>void }) {
  const reactMutation = useReactToProduct();
  const queryClient = useQueryClient();
  const [reaction, setReaction] = useState<'like'|'dislike'|null>(null);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const react = (value:'like'|'dislike') => {
    reactMutation.mutate({slug:product.slug,data:{reaction:reaction===value?'clear':value}},{onSuccess:()=>{
      setReaction(reaction===value?null:value);
      queryClient.invalidateQueries({queryKey:getGetStorefrontQueryKey()});
      queryClient.invalidateQueries({queryKey:getGetProductQueryKey(product.slug)});
    }});
  };
  const share = async () => {
    try {
      await copyProductLink(product.slug);
      setCopied(true);
      setShareError(false);
      window.setTimeout(()=>setCopied(false),1800);
    } catch {
      setShareError(true);
    }
  };
  return <article className="product-card" data-testid={`card-product-${product.id}`}>
    <Link href={`/p/${product.slug}`} className="block text-inherit no-underline" data-testid={`link-product-${product.id}`}>
      <div className="relative"><img className="product-image" src={product.imageUrl || FOOD_PLACEHOLDER} alt={product.name} loading="lazy" />
        {!product.isAvailable && <span className="absolute top-3 left-3 pill bg-background/90">Agotado</span>}
        {product.offerPrice !== null && <span className="absolute top-3 right-3 pill bg-accent text-white">Oferta</span>}
      </div>
      <div className="px-3.5 pt-3 pb-2">
        <div className="eyebrow text-muted-foreground truncate">{product.category || 'De la casa'}</div>
        <h3 className="serif text-[18px] leading-tight mt-1">{product.name}</h3>
        <p className="text-[12px] text-muted-foreground mt-1 line-clamp-2 min-h-[32px]">{product.description}</p>
        <div className="flex items-baseline gap-2 mt-2">
          <strong className="text-sm">{currencyText(currentPrice(product))}</strong>
          {product.offerPrice !== null && <del className="text-xs text-muted-foreground">{currencyText(product.price)}</del>}
        </div>
      </div>
    </Link>
    <div className="px-3.5 flex items-center justify-between border-t border-border/70" aria-label={`Interacciones de ${product.name}`}>
      <div className="flex items-center">
        <button className={`icon-btn !w-9 !h-9 ${reaction==='like'?'text-accent':''}`} disabled={reactMutation.isPending} onClick={()=>react('like')} aria-label={`Me gusta ${product.name}`} data-testid={`button-like-product-${product.id}`}><ThumbsUp size={14}/><span className="text-[10px]">{product.likeCount}</span></button>
        <button className={`icon-btn !w-9 !h-9 ${reaction==='dislike'?'text-accent':''}`} disabled={reactMutation.isPending} onClick={()=>react('dislike')} aria-label={`No me gusta ${product.name}`} data-testid={`button-dislike-product-${product.id}`}><ThumbsDown size={14}/><span className="text-[10px]">{product.dislikeCount}</span></button>
        <Link href={`/p/${product.slug}#comments`} className="icon-btn !w-9 !h-9 no-underline text-inherit" aria-label={`Comentar ${product.name}`} data-testid={`link-comments-product-${product.id}`}><MessageCircle size={14}/></Link>
      </div>
      <button className="icon-btn !w-9 !h-9" onClick={share} aria-label={`Compartir ${product.name}`} data-testid={`button-share-product-${product.id}`}><Share2 size={14}/></button>
    </div>
    {(copied||shareError||reactMutation.isError)&&<div className="px-3.5 pb-2 text-[10px] text-muted-foreground" role={shareError||reactMutation.isError?'alert':'status'}>{shareError?'No se pudo copiar el enlace.':reactMutation.isError?'No se guardó la reacción.':copied?'Enlace copiado.':''}</div>}
    <div className="px-3.5 pb-3"><button className="btn btn-soft w-full !py-2.5 text-xs" disabled={!product.isAvailable} onClick={() => add(product)} data-testid={`button-add-product-${product.id}`}><Plus size={14}/>{product.isAvailable ? 'Sumar al pedido' : 'No disponible'}</button></div>
  </article>;
}
function ShopHome() {
  const query = useGetStorefront();
  const { add, count } = useCart();
  const [category, setCategory] = useState('Todo');
  if (query.isLoading) return <main className="page-wrap py-10"><div className="skeleton h-48 mb-8"/><div className="product-grid">{[1,2,3,4,5,6].map(n=><div className="skeleton aspect-square" key={n}/>)}</div></main>;
  if (query.isError || !query.data) return <FullPageMessage title="No pudimos abrir el menú" detail="La carta no está disponible en este momento. Prueba otra vez en un instante." retry={() => query.refetch()}/>;
  const { store, products, zones } = query.data;
  const categories = ['Todo', ...Array.from(new Set(products.map(p=>p.category).filter(Boolean)))];
  const visible = products.filter(p => category === 'Todo' || p.category === category);
  return <div className="shell texture">
    <ShopHeader store={store} cartCount={count}/>
    <main className="page-wrap pb-16">
      <section className="relative overflow-hidden rounded-[24px] bg-[#1f4535] text-[#fbf5e9] px-6 py-8 sm:px-10 sm:py-10 min-h-[216px] flex items-end reveal">
        <div className="absolute right-[-25px] top-[-60px] w-64 h-64 rounded-full border border-white/10"/>
        <div className="absolute right-10 top-5 w-36 h-36 rounded-full border border-white/10"/>
        <div className="absolute right-[-10px] bottom-[-35px] text-[190px] leading-none serif text-white/[.07]">“</div>
        <div className="relative max-w-lg">
          <div className="eyebrow text-[#d9b968] mb-3 flex items-center gap-2"><span className="w-5 border-t border-[#d9b968]"/>COMIDA HECHA CERCA</div>
          <h1 className="serif text-4xl sm:text-5xl leading-[1.02]">{store.tagline || 'Una mesa rica, a la vuelta.'}</h1>
          <p className="text-sm text-white/70 mt-3">{store.isOpen ? 'Estamos tomando pedidos para hoy.' : 'Ahora estamos cerrados. Puedes mirar la carta.'}</p>
          <div className="mt-5 flex flex-wrap gap-2"><span className="pill !bg-white/10 !text-white"><MapPin size={13} className="mr-1.5"/>{store.physicalAddress || 'Tu barrio'}</span><span className="pill !bg-white/10 !text-white"><Truck size={13} className="mr-1.5"/>{zones.filter(z=>z.isActive).length ? `${zones.filter(z=>z.isActive).length} zonas de entrega` : 'Retiro disponible'}</span></div>
        </div>
        <div className="absolute top-6 right-7 hidden sm:block text-right"><div className="eyebrow text-[#d9b968]">HECHO CON CARIÑO</div><div className="serif text-xl mt-1">y buenos ingredientes</div></div>
      </section>
      <section className="mt-8">
        <div className="flex items-end justify-between gap-3 mb-4">
          <div><div className="eyebrow text-accent">LA CARTA</div><h2 className="serif text-3xl mt-1">Para antojarse</h2></div>
          <span className="hidden sm:block text-xs text-muted-foreground">{products.length} preparaciones · actualizado hoy</span>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-4 mb-1">{categories.map(c=><button key={c} className={`pill border cursor-pointer whitespace-nowrap ${category===c?'!bg-primary !text-primary-foreground !border-primary':'bg-transparent'}`} onClick={()=>setCategory(c)} data-testid={`filter-category-${c}`}>{c}</button>)}</div>
        {visible.length ? <div className="product-grid">{visible.map((p,i)=><div className={i<2?'reveal-2':''} key={p.id}><ProductCard product={p} add={add}/></div>)}</div> : <div className="panel text-center py-14"><div className="serif text-2xl">Todavía no hay platos aquí</div><p className="text-sm text-muted-foreground mt-2">Prueba otra categoría.</p></div>}
      </section>
      <footer className="mt-12 pt-6 border-t border-border flex flex-col sm:flex-row gap-3 justify-between text-xs text-muted-foreground">
        <span>{store.physicalAddress}</span><span>Pedidos por WhatsApp · Pago móvil</span><Link href="/admin" className="text-primary no-underline font-bold" data-testid="link-owner-admin">¿Eres quien cocina? Acceso del negocio</Link>
      </footer>
    </main>
  </div>;
}
function ProductPage() {
  const { slug = '' } = useParams<{slug:string}>();
  const productQuery = useGetProduct(slug);
  const storefront = useGetStorefront();
  const commentsQuery = useListProductComments(slug);
  useEffect(()=>{
    if(productQuery.data && window.location.hash==='#comments') {
      window.requestAnimationFrame(()=>document.getElementById('comments')?.scrollIntoView({behavior:'smooth'}));
    }
  },[slug,productQuery.data]);
  const { add, count } = useCart();
  const queryClient = useQueryClient();
  const reactMutation = useReactToProduct();
  const commentMutation = useCreateProductComment();
  const [reaction, setReaction] = useState<'like'|'dislike'|null>(null);
  const [copied, setCopied] = useState(false);
  const [shareError, setShareError] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [content, setContent] = useState('');
  if (productQuery.isLoading) return <main className="page-wrap py-8"><div className="skeleton aspect-square max-w-md"/><div className="skeleton h-12 mt-5"/></main>;
  if (productQuery.isError || !productQuery.data) return <FullPageMessage title="No encontramos ese plato" detail="Puede que haya cambiado de nombre o ya no esté en la carta." retry={()=>productQuery.refetch()}/>;
  const p = productQuery.data.product;
  const comments = commentsQuery.data || productQuery.data.comments || [];
  const share = async () => {
    try {
      await copyProductLink(p.slug);
      setCopied(true);
      setShareError(false);
      window.setTimeout(()=>setCopied(false),1800);
    } catch {
      setShareError(true);
    }
  };
  const react = (value:'like'|'dislike') => {
    const next = reaction === value ? 'clear' : value;
    reactMutation.mutate({slug,data:{reaction:next}}, {onSuccess:result=>{
      setReaction(result.currentReaction);
      queryClient.setQueryData<ProductDetail>(getGetProductQueryKey(slug), old => old ? {...old,product:{...old.product,likeCount:result.likeCount,dislikeCount:result.dislikeCount}} : old);
    }});
  };
  const submitComment = (e:FormEvent) => {
    e.preventDefault();
    commentMutation.mutate({slug,data:{customerName:customerName.trim(),content:content.trim()}},{onSuccess:()=>{
      setContent(''); queryClient.invalidateQueries({queryKey:getListProductCommentsQueryKey(slug)});
      queryClient.invalidateQueries({queryKey:getGetProductQueryKey(slug)});
    }});
  };
  return <div className="shell texture">
    <ShopHeader store={storefront.data?.store || {storeName:'Menú Local'}} cartCount={count}/>
    <main className="page-wrap pb-14">
      <Link href="/" className="inline-flex items-center gap-2 text-xs text-muted-foreground no-underline mb-5" data-testid="link-back-menu"><ArrowLeft size={15}/>Volver a la carta</Link>
      <div className="grid md:grid-cols-[minmax(300px,1.05fr)_minmax(300px,.95fr)] gap-7 md:gap-11 items-start">
        <img src={p.imageUrl || FOOD_PLACEHOLDER} alt={p.name} className="w-full aspect-square object-cover rounded-[22px] bg-secondary reveal" data-testid={`img-product-${p.id}`}/>
        <section className="pt-1 reveal-2">
          <div className="eyebrow text-accent">{p.category || 'De la casa'}</div>
          <h1 className="serif text-4xl sm:text-5xl leading-[1.02] mt-3">{p.name}</h1>
          <p className="text-sm leading-6 text-muted-foreground mt-4">{p.description}</p>
          <div className="flex items-baseline gap-3 mt-5"><strong className="serif text-3xl">{currencyText(currentPrice(p))}</strong>{p.offerPrice !== null && <del className="text-muted-foreground">{currencyText(p.price)}</del>}</div>
          <div className="flex gap-2 mt-5">
            <button className={`btn ${reaction==='like'?'btn-primary':'btn-soft'}`} disabled={reactMutation.isPending} onClick={()=>react('like')} data-testid="button-like"><ThumbsUp size={15}/>{p.likeCount}</button>
            <button className={`btn ${reaction==='dislike'?'btn-primary':'btn-soft'}`} disabled={reactMutation.isPending} onClick={()=>react('dislike')} data-testid="button-dislike"><ThumbsDown size={15}/>{p.dislikeCount}</button>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <button className="btn btn-line !py-2 text-xs" onClick={share} data-testid="button-share-product"><Copy size={14}/>{copied?'Enlace copiado':'Compartir'}</button>
            {shareError&&<span className="text-[10px] text-destructive" role="alert">No se pudo copiar el enlace.</span>}
          </div>
          {reactMutation.isError && <p role="alert" className="text-xs text-destructive mt-2">No se pudo guardar tu reacción. Inténtalo otra vez.</p>}
          <button className="btn btn-coral w-full mt-6" disabled={!p.isAvailable} onClick={()=>add(p)} data-testid="button-add-to-order"><Plus size={16}/>{p.isAvailable?'Añadir al pedido':'No disponible ahora'}</button>
          <div className="panel mt-7 p-4 flex items-start gap-3"><span className="w-9 h-9 rounded-full bg-secondary grid place-items-center"><Heart size={16} className="text-accent"/></span><p className="text-xs text-muted-foreground leading-5 m-0">Preparado al momento, en la cocina de tu barrio. Si tienes una pregunta, déjanos un comentario.</p></div>
          <section className="mt-8" id="comments">
            <div className="flex items-center gap-2 mb-4"><MessageCircle size={17}/><h2 className="serif text-2xl">Lo que dicen</h2><span className="pill">{comments.length}</span></div>
            {commentsQuery.isLoading ? <div className="skeleton h-20"/> : commentsQuery.isError ? <div className="panel p-4 text-xs text-muted-foreground">Los comentarios no cargaron. <button className="underline" onClick={()=>commentsQuery.refetch()}>Reintentar</button></div> : comments.length ? <div className="grid gap-3">{comments.map(c=><Comment key={c.id} comment={c}/>)}</div> : <p className="text-sm text-muted-foreground">Aún no hay comentarios. Empieza tú.</p>}
            <form onSubmit={submitComment} className="panel p-4 mt-4">
              <div className="field"><label htmlFor="comment-name">Tu nombre</label><input id="comment-name" value={customerName} onChange={e=>setCustomerName(e.target.value)} minLength={2} maxLength={60} required placeholder="¿Cómo te llamas?" data-testid="input-comment-name"/></div>
              <div className="field mb-2"><label htmlFor="comment-content">Comentario</label><textarea id="comment-content" value={content} onChange={e=>setContent(e.target.value)} maxLength={500} required placeholder="Cuéntanos qué te pareció…" data-testid="input-comment-content"/></div>
              {commentMutation.isError && <p className="text-xs text-destructive mb-3">No se pudo publicar. Revisa los datos y vuelve a intentar.</p>}
              <button className="btn btn-primary w-full" disabled={commentMutation.isPending} data-testid="button-submit-comment">{commentMutation.isPending?'Publicando…':'Publicar comentario'}<ArrowRight size={15}/></button>
            </form>
          </section>
        </section>
      </div>
    </main>
  </div>;
}
function Comment({ comment }: { comment:ProductComment }) {
  return <article className="border-b border-border pb-3" data-testid={`comment-${comment.id}`}>
    <div className="flex justify-between gap-3"><strong className="text-xs">{comment.customerName}</strong><time className="text-[10px] text-muted-foreground">{new Date(comment.createdAt).toLocaleDateString('es-VE',{day:'numeric',month:'short'})}</time></div>
    <p className="text-sm text-muted-foreground mt-1 mb-0">{comment.content}</p>
  </article>;
}
function CheckoutPage() {
  const storefront = useGetStorefront();
  const { cart, count, total, setQty, clear } = useCart();
  const createOrder = useCreateOrder();
  const [created, setCreated] = useState<{id:number;total:number;whatsappUrl:string}|null>(null);
  const [fulfillment,setFulfillment] = useState<'delivery'|'pickup'>('delivery');
  const [form,setForm] = useState({customerName:'',cedula:'',phone:'',zoneId:'',address:'',referencePoint:'',notes:'',paymentReference:''});
  const store = storefront.data?.store;
  const zones = storefront.data?.zones.filter(z=>z.isActive) || [];
  const selectedZone = zones.find(z=>String(z.id)===form.zoneId);
  const amount = total + (fulfillment==='delivery' ? selectedZone?.deliveryFee || 0 : 0);
  const patch = (key:keyof typeof form, value:string) => setForm(old=>({...old,[key]:value}));
  const submit = (e:FormEvent) => {
    e.preventDefault();
    const whatsappTab = window.open('about:blank','_blank');
    if(whatsappTab) whatsappTab.opener=null;
    const payload:OrderInput = {
      customerName:form.customerName.trim(),cedula:form.cedula.trim().toUpperCase(),phone:form.phone.trim(),
      fulfillment,zoneId:fulfillment==='delivery' && form.zoneId ? Number(form.zoneId) : null,
      address:fulfillment==='delivery'?form.address.trim():'',referencePoint:fulfillment==='delivery'?form.referencePoint.trim():'',
      notes:form.notes.trim(),paymentReference:form.paymentReference.trim(),
      items:Object.values(cart).map(item=>({productId:item.product.id,quantity:item.quantity})),
    };
    createOrder.mutate({data:payload},{onSuccess:result=>{
      setCreated({id:result.id,total:result.total,whatsappUrl:result.whatsappUrl});
      clear();
      if(whatsappTab) whatsappTab.location.replace(result.whatsappUrl);
      else window.location.assign(result.whatsappUrl);
    },onError:()=>whatsappTab?.close()});
  };
  if(storefront.isLoading) return <main className="page-wrap py-8"><div className="skeleton h-12 w-1/3 mb-8"/><div className="skeleton h-72"/></main>;
  if(storefront.isError || !store) return <FullPageMessage title="No podemos preparar el pedido" detail="No fue posible cargar los datos de pago y entrega." retry={()=>storefront.refetch()}/>;
  if(created) return <div className="shell texture grid place-items-center px-5"><section className="panel p-7 sm:p-10 max-w-lg w-full text-center">
    <div className="w-14 h-14 bg-primary text-primary-foreground rounded-full grid place-items-center mx-auto"><Check size={24}/></div>
    <div className="eyebrow text-accent mt-5">PEDIDO RECIBIDO</div><h1 className="serif text-4xl mt-2">Gracias, {form.customerName.split(' ')[0]}.</h1>
    <p className="text-sm text-muted-foreground mt-3">Tu pedido <b>#{created.id}</b> quedó pendiente de revisión. El comprobante no se verifica automáticamente; el negocio confirmará el pago.</p>
    <div className="panel p-4 mt-6 text-left"><div className="eyebrow text-muted-foreground">TOTAL REGISTRADO</div><div className="serif text-2xl mt-1">{money(created.total)}</div><div className="status-pill inline-block mt-3">Pendiente de verificación</div></div>
    <a href={created.whatsappUrl} target="_blank" rel="noreferrer" className="btn btn-primary w-full mt-5" data-testid="link-confirm-whatsapp"><MessageCircle size={16}/>Continuar por WhatsApp<ExternalLink size={14}/></a>
    <Link href="/" className="btn btn-line w-full mt-3" onClick={()=>clear()} data-testid="link-back-after-order">Volver al menú</Link>
  </section></div>;
  const items=Object.values(cart);
  return <div className="shell texture">
    <header className="page-wrap py-5"><Link href="/" className="inline-flex items-center gap-2 text-sm no-underline text-inherit" data-testid="link-checkout-back"><ArrowLeft size={16}/><Brand name={store.storeName} logo={store.logoUrl}/></Link></header>
    <main className="page-wrap pb-14">
      <div className="eyebrow text-accent">CASI LISTO</div><h1 className="serif text-4xl sm:text-5xl mt-1">Tu pedido</h1>
      {!items.length ? <div className="panel p-8 text-center mt-6"><ShoppingBag className="mx-auto text-muted-foreground"/><h2 className="serif text-2xl mt-3">Tu bolsa está vacía</h2><p className="text-sm text-muted-foreground">Añade algo rico antes de seguir.</p><Link href="/" className="btn btn-primary mt-3" data-testid="link-shop-empty">Ver la carta<ArrowRight size={15}/></Link></div> : <form onSubmit={submit} className="grid md:grid-cols-[1fr_350px] gap-6 mt-6">
        <div className="grid gap-5 content-start">
          <section className="panel p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-5"><span className="w-7 h-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs">1</span><h2 className="serif text-2xl">¿Quién recibe?</h2></div>
            <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Nombre y apellido"><input value={form.customerName} onChange={e=>patch('customerName',e.target.value)} minLength={2} maxLength={100} required autoComplete="name" data-testid="input-customer-name"/></Field>
              <Field label="Cédula"><input value={form.cedula} onChange={e=>patch('cedula',e.target.value.toUpperCase())} placeholder="V-12345678" pattern="[VEJPG]-?[0-9]{6,9}" minLength={7} maxLength={12} required data-testid="input-customer-cedula"/></Field>
              <Field label="Teléfono"><input value={form.phone} onChange={e=>patch('phone',e.target.value)} type="tel" minLength={7} maxLength={20} required autoComplete="tel" placeholder="+58 412 123 4567" data-testid="input-customer-phone"/></Field>
            </div>
          </section>
          <section className="panel p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-5"><span className="w-7 h-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs">2</span><h2 className="serif text-2xl">¿Cómo lo recibes?</h2></div>
            <div className="grid grid-cols-2 gap-2 mb-5">
              <button type="button" className={`btn rounded-xl border ${fulfillment==='delivery'?'!bg-primary !text-primary-foreground border-primary':'btn-line'}`} onClick={()=>setFulfillment('delivery')} data-testid="button-fulfillment-delivery"><Truck size={16}/>A domicilio</button>
              <button type="button" disabled={!store.pickupEnabled} className={`btn rounded-xl border ${fulfillment==='pickup'?'!bg-primary !text-primary-foreground border-primary':'btn-line'}`} onClick={()=>setFulfillment('pickup')} data-testid="button-fulfillment-pickup"><MapPin size={16}/>Retiro</button>
            </div>
            {fulfillment==='delivery' ? <div className="grid sm:grid-cols-2 gap-x-4">
              <Field label="Zona de entrega"><select value={form.zoneId} onChange={e=>patch('zoneId',e.target.value)} required data-testid="select-delivery-zone"><option value="">Elige una zona</option>{zones.map(z=><option key={z.id} value={z.id}>{z.name} · {money(z.deliveryFee)}</option>)}</select></Field>
              <Field label="Dirección"><input value={form.address} onChange={e=>patch('address',e.target.value)} minLength={8} maxLength={300} required placeholder="Calle, edificio, casa…" data-testid="input-delivery-address"/></Field>
              <Field label="Punto de referencia"><input value={form.referencePoint} onChange={e=>patch('referencePoint',e.target.value)} minLength={3} maxLength={200} required placeholder="A una cuadra de…" data-testid="input-reference-point"/></Field>
            </div> : <p className="text-sm text-muted-foreground -mt-1 mb-3">{store.physicalAddress || 'Coordina el retiro por WhatsApp.'}</p>}
            <Field label="Nota para la cocina o repartidor"><textarea value={form.notes} onChange={e=>patch('notes',e.target.value)} maxLength={500} placeholder="Sin cebolla, tocar el timbre…" data-testid="input-order-notes"/></Field>
          </section>
          <section className="panel p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-5"><span className="w-7 h-7 rounded-full bg-primary text-primary-foreground grid place-items-center text-xs">3</span><h2 className="serif text-2xl">Pago móvil</h2></div>
            <p className="text-sm text-muted-foreground mb-4">Transfiere el total y luego escribe aquí el número de referencia de 6 dígitos. El pago será revisado por el negocio.</p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {[['Banco',store.bankName],['Cédula / ID',store.bankId],['Teléfono',store.bankPhone]].map(([label,value])=><div className="rounded-xl bg-secondary/70 p-3 min-w-0" key={label}><div className="eyebrow text-muted-foreground">{label}</div><div className="text-xs font-bold mt-1 break-words">{value || 'No configurado'}</div></div>)}
            </div>
            <Field label="Referencia de pago (6 dígitos)"><input value={form.paymentReference} onChange={e=>patch('paymentReference',e.target.value.replace(/\D/g,'').slice(0,6))} inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required placeholder="000000" data-testid="input-payment-reference"/></Field>
          </section>
        </div>
        <aside className="panel p-5 h-fit md:sticky md:top-5">
          <h2 className="serif text-2xl">En la bolsa <span className="text-muted-foreground">({count})</span></h2>
          <div className="divide-y divide-border mt-3">{items.map(({product,quantity})=><div className="py-3 flex gap-3 items-center" key={product.id}>
            <img src={product.imageUrl||FOOD_PLACEHOLDER} alt="" className="w-14 h-14 object-cover rounded-lg bg-secondary"/>
            <div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{product.name}</div><div className="text-xs text-muted-foreground">{money(currentPrice(product))}</div></div>
            <div className="flex items-center gap-1"><button type="button" className="icon-btn !w-7 !h-7" onClick={()=>setQty(product,quantity-1)} aria-label="Quitar uno" data-testid={`button-decrease-${product.id}`}><Minus size={13}/></button><span className="text-xs w-4 text-center">{quantity}</span><button type="button" className="icon-btn !w-7 !h-7" onClick={()=>setQty(product,quantity+1)} aria-label="Añadir uno" data-testid={`button-increase-${product.id}`}><Plus size={13}/></button></div>
          </div>)}</div>
          <div className="border-t border-border pt-3 mt-1 grid gap-2 text-sm">
            <div className="flex justify-between"><span>Productos</span><span>{money(total)}</span></div>
            <div className="flex justify-between"><span>Entrega</span><span>{fulfillment==='delivery'?money(selectedZone?.deliveryFee||0):'Sin costo'}</span></div>
            <div className="flex justify-between font-bold pt-2 border-t border-border"><span>Total</span><span className="serif text-xl">{money(amount)}</span></div>
          </div>
          {createOrder.isError && <p role="alert" className="text-xs text-destructive mt-3">{(createOrder.error as Error)?.message || 'No se pudo registrar el pedido. Revisa los datos y vuelve a intentar.'}</p>}
          {(!store.whatsappNumber || !store.bankName || !store.bankId || !store.bankPhone) && <p className="text-xs text-muted-foreground mt-3">El negocio aún debe completar los datos de Pago Móvil y WhatsApp.</p>}
          <button className="btn btn-primary w-full mt-4" disabled={createOrder.isPending || !store.isOpen || !items.length || !store.whatsappNumber || !store.bankName || !store.bankId || !store.bankPhone || (fulfillment==='delivery' && !zones.length)} data-testid="button-place-order">{createOrder.isPending?'Enviando pedido…':!store.isOpen?'El negocio está cerrado':'Confirmar pedido'}<ArrowRight size={15}/></button>
          <p className="text-[10px] text-muted-foreground text-center leading-4 mt-3">Al confirmar, tu pedido queda pendiente. No verificamos pagos automáticamente.</p>
        </aside>
      </form>}
    </main>
  </div>;
}
function Field({label,children}:{label:string;children:ReactNode}) { return <div className="field"><label>{label}</label>{children}</div>; }

function AdminGate() {
  const session = useGetAdminSession();
  const createSession = useCreateAdminSession();
  const client = useQueryClient();
  const [pin,setPin] = useState('');
  const [message,setMessage] = useState('');
  const submit = (e:FormEvent) => {
    e.preventDefault(); setMessage('');
    createSession.mutate({data:{pin}},{onSuccess:()=>{
      client.invalidateQueries({queryKey:getGetAdminSessionQueryKey()});
    },onError:()=>setMessage('Ese PIN no funcionó. Comprueba los dígitos e inténtalo otra vez.')});
  };
  if(session.isLoading) return <div className="shell grid place-items-center"><div className="w-full max-w-sm p-6"><div className="skeleton h-10 w-32 mb-5"/><div className="skeleton h-52"/></div></div>;
  if(session.data?.authenticated) return <AdminDashboard/>;
  return <div className="shell texture grid md:grid-cols-[1.1fr_.9fr]">
    <div className="hidden md:flex bg-[#1f4535] text-[#fbf5e9] p-12 flex-col justify-between relative overflow-hidden">
      <div className="absolute right-[-100px] bottom-[-100px] w-[440px] h-[440px] rounded-full border border-white/10"/>
      <Brand name="Menú Local" inverse/>
      <div className="relative"><div className="eyebrow text-[#dfbd6e]">ESTUDIO DEL NEGOCIO</div><h1 className="serif text-6xl leading-[1.02] mt-4 max-w-xl">Tu cocina,<br/>a tu manera.</h1><p className="text-sm text-white/65 max-w-sm mt-5 leading-6">Actualiza la carta, organiza los pedidos y deja que el barrio encuentre lo que preparas.</p></div>
      <div className="eyebrow text-white/40">MENÚ LOCAL · PANEL PRIVADO</div>
    </div>
    <div className="grid place-items-center p-6">
      <form onSubmit={submit} className="panel p-7 sm:p-9 w-full max-w-md reveal">
        <div className="md:hidden mb-8"><Brand name="Menú Local"/></div>
        <div className="eyebrow text-accent">ACCESO DEL NEGOCIO</div><h2 className="serif text-4xl mt-2">Hola de nuevo.</h2><p className="text-sm text-muted-foreground mt-2 mb-7">Ingresa tu PIN para administrar la tienda.</p>
        <Field label="PIN de administración"><input value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,'').slice(0,12))} type="password" inputMode="numeric" minLength={4} maxLength={12} required autoComplete="current-password" placeholder="••••••" data-testid="input-admin-pin"/></Field>
        {message && <p role="alert" className="text-xs text-destructive mb-4" data-testid="status-admin-login">{message}</p>}
        {createSession.isError && !message && <p role="alert" className="text-xs text-destructive mb-4">No pudimos iniciar sesión. Inténtalo de nuevo.</p>}
        <button className="btn btn-primary w-full" disabled={createSession.isPending} data-testid="button-admin-login">{createSession.isPending?'Verificando…':'Entrar al panel'}<ArrowRight size={15}/></button>
        <Link href="/" className="block text-center text-xs text-muted-foreground no-underline mt-5" data-testid="link-admin-to-menu">← Volver al menú público</Link>
      </form>
    </div>
  </div>;
}
type AdminTab = 'overview'|'orders'|'products'|'delivery'|'settings';
function AdminDashboard() {
  const client=useQueryClient();
  const overview=useGetAdminOverview();
  const logout=useDeleteAdminSession();
  const statusMutation=useUpdateOrderStatus();
  const deleteProductMutation=useDeleteProduct();
  const deleteZoneMutation=useDeleteDeliveryZone();
  const [tab,setTab]=useState<AdminTab>('overview');
  const [productEdit,setProductEdit]=useState<Product|null|undefined>(undefined);
  const [zoneEdit,setZoneEdit]=useState<DeliveryZone|null|undefined>(undefined);
  const [notice,setNotice]=useState('');
  const refresh=()=>client.invalidateQueries({queryKey:getGetAdminOverviewQueryKey()});
  if(overview.isLoading) return <div className="admin-layout"><AdminSidebar tab={tab} setTab={setTab}/><main className="admin-main"><div className="skeleton h-12 w-60 mb-8"/><div className="metric-grid">{[1,2,3].map(i=><div className="skeleton h-28" key={i}/>)}</div><div className="skeleton h-64 mt-6"/></main></div>;
  if(overview.isError || !overview.data) return <div className="admin-layout"><AdminSidebar tab={tab} setTab={setTab}/><main className="admin-main grid place-items-center"><div className="panel p-8 text-center"><h1 className="serif text-3xl">No cargó el panel</h1><p className="text-sm text-muted-foreground">Comprueba tu conexión e inténtalo de nuevo.</p><button className="btn btn-primary mt-3" onClick={()=>overview.refetch()} data-testid="button-retry-admin">Reintentar</button></div></main></div>;
  const data=overview.data as AdminOverview;
  const updateStatus=(order:AdminOrder,status:AdminOrder['status'])=>statusMutation.mutate({id:order.id,data:{status}},{onSuccess:refresh,onError:()=>setNotice('No se pudo cambiar el estado del pedido.')});
  const logoutNow=()=>logout.mutate(undefined,{onSuccess:()=>client.invalidateQueries({queryKey:getGetAdminSessionQueryKey()})});
  return <div className="admin-layout">
    <AdminSidebar tab={tab} setTab={setTab} logout={logoutNow} logoutPending={logout.isPending}/>
    <main className="admin-main">
      <div className="flex items-start justify-between gap-4 mb-7">
        <div><div className="eyebrow text-accent">MENÚ LOCAL / {tab.toUpperCase()}</div><h1 className="serif text-4xl mt-1">{tab==='overview'?'Buen día.':tab==='orders'?'Pedidos':tab==='products'?'Tu carta':tab==='delivery'?'Entrega':'Tu negocio'}</h1></div>
        <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground bg-card border border-border rounded-full px-3 py-2"><span className={`w-2 h-2 rounded-full ${data.store.isOpen?'bg-emerald-600':'bg-rose-500'}`}/>{data.store.isOpen?'Recibiendo pedidos':'Cerrado'}</div>
      </div>
      {notice && <div className="panel p-3 mb-4 text-sm flex justify-between" role="status">{notice}<button className="underline" onClick={()=>setNotice('')}>Cerrar</button></div>}
      {tab==='overview' && <OverviewTab data={data} setTab={setTab} updateStatus={updateStatus}/>}
      {tab==='orders' && <OrdersTab orders={data.orders} updateStatus={updateStatus}/>}
      {tab==='products' && <ProductsTab products={data.products} onAdd={()=>setProductEdit(null)} onEdit={p=>setProductEdit(p)} onDelete={id=>{
        if(window.confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) {
          deleteProductMutation.mutate({id},{onSuccess:()=>{refresh();client.invalidateQueries({queryKey:getGetStorefrontQueryKey()});setNotice('Producto eliminado.')},onError:()=>setNotice('No se pudo eliminar el producto.')});
        }
      }}/>}
      {tab==='delivery' && <DeliveryTab zones={data.zones} onAdd={()=>setZoneEdit(null)} onEdit={z=>setZoneEdit(z)} onDelete={id=>{
        if(window.confirm('¿Eliminar esta zona de entrega?')) deleteZoneMutation.mutate({id},{onSuccess:()=>{refresh();client.invalidateQueries({queryKey:getGetStorefrontQueryKey()})},onError:()=>setNotice('No se pudo eliminar la zona.')});
      }}/>}
      {tab==='settings' && <SettingsTab settings={data.store} onSaved={()=>{refresh();client.invalidateQueries({queryKey:getGetStorefrontQueryKey()});setNotice('Cambios guardados.');}}/>}
      {productEdit !== undefined && <ProductEditor product={productEdit} close={()=>setProductEdit(undefined)} saved={()=>{setProductEdit(undefined);refresh();client.invalidateQueries({queryKey:getGetStorefrontQueryKey()});client.invalidateQueries({predicate:q=>String(q.queryKey[0]).startsWith('/api/products/')});setNotice('Carta actualizada.');}}/>}
      {zoneEdit !== undefined && <ZoneEditor zone={zoneEdit} close={()=>setZoneEdit(undefined)} saved={()=>{setZoneEdit(undefined);refresh();client.invalidateQueries({queryKey:getGetStorefrontQueryKey()});setNotice('Zona guardada.');}}/>}
    </main>
  </div>;
}

function AdminSidebar({tab,setTab,logout,logoutPending}:{tab:AdminTab;setTab:(t:AdminTab)=>void;logout?:()=>void;logoutPending?:boolean}) {
  const items:[AdminTab,string,typeof Store][]=[['overview','Resumen',ChartNoAxesColumnIncreasing],['orders','Pedidos',ClipboardList],['products','Carta',Package],['delivery','Entrega',Truck],['settings','Negocio',Settings2]];
  return <aside className="admin-side">
    <Link href="/" className="admin-side-brand no-underline text-inherit" data-testid="link-admin-brand"><Brand name="Menú Local" inverse/></Link>
    <nav className="admin-nav" aria-label="Administración">{items.map(([key,label,Icon])=><button key={key} className={tab===key?'active':''} onClick={()=>setTab(key)} data-testid={`nav-admin-${key}`}><Icon size={17}/><span>{label}</span></button>)}
      {logout&&<button className="mobile-logout" onClick={logout} disabled={logoutPending} data-testid="button-admin-logout-mobile"><LogOut size={17}/><span>Salir</span></button>}
    </nav>
    <div className="admin-side-foot mt-auto">
      <Link href="/" className="text-xs text-white/60 no-underline flex items-center gap-2 px-3 mb-4" data-testid="link-public-store"><ExternalLink size={14}/>Ver tienda pública</Link>
      {logout && <button className="admin-nav !flex !w-full" onClick={logout} disabled={logoutPending} data-testid="button-admin-logout"><LogOut size={16}/>Cerrar sesión</button>}
    </div>
  </aside>;
}
function OverviewTab({data,setTab,updateStatus}:{data:AdminOverview;setTab:(t:AdminTab)=>void;updateStatus:(o:AdminOrder,s:AdminOrder['status'])=>void}) {
  const {metrics,orders,products}=data;
  return <div className="reveal">
    <div className="metric-grid">
      <Metric title="Pedidos hoy" value={metrics.ordersToday} note="Desde medianoche" icon={<ClipboardList size={17}/>}/>
      <Metric title="Por revisar" value={metrics.pendingOrders} note="Pago pendiente de confirmar" icon={<Clock3 size={17}/>}/>
      <Metric title="Ventas hoy" value={money(metrics.salesToday)} note="Pedidos registrados" icon={<ChartNoAxesColumnIncreasing size={17}/>}/>
    </div>
    <section className="panel p-5 mt-6">
      <div className="flex items-center justify-between mb-4"><div><div className="eyebrow text-accent">LO MÁS RECIENTE</div><h2 className="serif text-2xl mt-1">Pedidos nuevos</h2></div><button className="btn btn-soft !py-2" onClick={()=>setTab('orders')} data-testid="button-view-all-orders">Ver todos<ArrowRight size={14}/></button></div>
      {orders.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Cliente</th><th>Recibe</th><th>Total</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{orders.slice(0,5).map(o=><tr key={o.id} data-testid={`row-order-${o.id}`}><td><b>{o.customerName}</b><div className="text-[10px] text-muted-foreground">#{o.id} · {new Date(o.createdAt).toLocaleTimeString('es-VE',{hour:'2-digit',minute:'2-digit'})}</div></td><td>{o.fulfillment==='pickup'?'Retiro':'Entrega'}<div className="text-[10px] text-muted-foreground">{o.zoneName||''}</div></td><td>{money(o.total)}</td><td><StatusPill status={o.status}/></td><td><select className="rounded-lg border border-border px-2 py-1.5 bg-background text-xs" value={o.status} onChange={e=>updateStatus(o,e.target.value as AdminOrder['status'])} data-testid={`select-order-status-${o.id}`}><StatusOptions/></select></td></tr>)}</tbody></table></div> : <EmptyState title="La cocina está tranquila" detail="Cuando llegue un pedido aparecerá aquí."/>}
    </section>
    <section className="mt-6">
      <div className="flex justify-between items-end mb-3"><div><div className="eyebrow text-accent">EN VITRINA</div><h2 className="serif text-2xl mt-1">Tu carta</h2></div><button className="text-xs font-bold text-primary" onClick={()=>setTab('products')} data-testid="button-manage-menu">Administrar carta</button></div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">{products.slice(0,3).map(p=><div key={p.id} className="panel p-3 flex gap-3 items-center"><img src={p.imageUrl||FOOD_PLACEHOLDER} alt="" className="w-14 h-14 rounded-xl object-cover bg-secondary"/><div className="min-w-0"><div className="font-bold text-sm truncate">{p.name}</div><div className="text-xs text-muted-foreground">{money(currentPrice(p))} · {p.isAvailable?'Disponible':'Pausado'}</div></div></div>)}</div>
    </section>
  </div>;
}
function Metric({title,value,note,icon}:{title:string;value:string|number;note:string;icon:ReactNode}) {
  return <article className="panel p-4 sm:p-5" data-testid={`metric-${title.toLowerCase().replaceAll(' ','-')}`}><div className="flex justify-between items-center text-muted-foreground"><span className="eyebrow">{title}</span><span className="w-8 h-8 rounded-full bg-secondary grid place-items-center">{icon}</span></div><div className="serif text-3xl mt-3">{value}</div><div className="text-[10px] text-muted-foreground mt-1">{note}</div></article>;
}
function OrdersTab({orders,updateStatus}:{orders:AdminOrder[];updateStatus:(o:AdminOrder,s:AdminOrder['status'])=>void}) {
  const [filter,setFilter]=useState('all');
  const shown=orders.filter(o=>filter==='all'||o.status===filter);
  return <section className="panel p-4 sm:p-6 reveal">
    <div className="flex flex-wrap justify-between items-center gap-3 mb-4"><div><div className="eyebrow text-accent">SEGUIMIENTO</div><h2 className="serif text-2xl mt-1">Todos los pedidos</h2></div><select className="rounded-full border border-border bg-background px-3 py-2 text-xs" value={filter} onChange={e=>setFilter(e.target.value)} data-testid="select-order-filter"><option value="all">Todos los estados</option><StatusOptions/></select></div>
    {!shown.length ? <EmptyState title="Sin pedidos para mostrar" detail="Los pedidos nuevos aparecerán en esta lista."/> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Pedido / cliente</th><th>Detalle</th><th>Pago móvil</th><th>Total</th><th>Estado</th><th>Actualizar estado</th></tr></thead><tbody>{shown.map(order=><tr key={order.id} data-testid={`row-order-${order.id}`}><td><b>#{order.id} · {order.customerName}</b><div className="text-[10px] text-muted-foreground">{order.phone} · {new Date(order.createdAt).toLocaleString('es-VE')}</div><div className="text-[10px] text-muted-foreground">C.I. {order.cedula}</div></td>
      <td>{order.items.map((it,i)=><div className="text-xs" key={`${it.productId}-${i}`}>{it.quantity} × {it.name}</div>)}<div className="text-[10px] text-muted-foreground mt-1">{order.fulfillment==='pickup'?'Retiro':`Entrega · ${order.zoneName||''}`}</div>{order.address&&<div className="text-[10px] text-muted-foreground max-w-40">{order.address} {order.referencePoint&&`· ${order.referencePoint}`}</div>}{order.notes&&<div className="text-[10px] italic mt-1">{order.notes}</div>}</td>
      <td><span className="font-mono font-bold tracking-wider">{order.paymentReference}</span><div className="text-[10px] text-muted-foreground">Revisar en banco</div></td><td>{money(order.total)}</td><td><StatusPill status={order.status}/></td><td><select className="rounded-lg border border-border px-2 py-1.5 bg-background text-xs" value={order.status} onChange={e=>updateStatus(order,e.target.value as AdminOrder['status'])} data-testid={`select-order-status-${order.id}`}><StatusOptions/></select></td>
    </tr>)}</tbody></table></div>}
  </section>;
}
function StatusOptions(){return <><option value="pending_verification">Por verificar</option><option value="confirmed">Confirmado</option><option value="preparing">Preparando</option><option value="ready">Listo</option><option value="delivered">Entregado</option><option value="rejected">Rechazado</option></>;}
function StatusPill({status}:{status:string}) {
  const names:Record<string,string>={pending_verification:'Por verificar',confirmed:'Confirmado',preparing:'Preparando',ready:'Listo',delivered:'Entregado',rejected:'Rechazado'};
  return <span className={`status-pill ${status==='delivered'?'!bg-emerald-100 !text-emerald-800':status==='rejected'?'!bg-rose-100 !text-rose-800':''}`} data-testid={`status-${status}`}>{names[status]||status}</span>;
}
function EmptyState({title,detail,action}:{title:string;detail:string;action?:ReactNode}) {
  return <div className="rounded-2xl border border-dashed border-border p-8 text-center"><span className="w-10 h-10 rounded-full bg-secondary inline-grid place-items-center"><ShoppingBag size={18}/></span><h3 className="serif text-xl mt-3">{title}</h3><p className="text-xs text-muted-foreground">{detail}</p>{action}</div>;
}
function ProductsTab({products,onAdd,onEdit,onDelete}:{products:Product[];onAdd:()=>void;onEdit:(p:Product)=>void;onDelete:(id:number)=>void}) {
  const toggle=useUpdateProduct();
  const client=useQueryClient();
  return <section className="reveal">
    <div className="flex flex-wrap items-end justify-between gap-4 mb-5"><div><div className="eyebrow text-accent">PUBLICACIONES</div><h2 className="serif text-2xl mt-1">{products.length} productos</h2></div><button className="btn btn-primary" onClick={onAdd} data-testid="button-add-product"><Plus size={16}/>Añadir producto</button></div>
    {products.length===0 ? <EmptyState title="La carta está por empezar" detail="Añade el primer plato para que el barrio pueda encontrarlo." action={<button className="btn btn-primary mt-4" onClick={onAdd} data-testid="button-add-first-product">Crear primer producto</button>}/> :
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">{products.map(p=><article className="panel overflow-hidden" key={p.id} data-testid={`admin-product-${p.id}`}>
        <div className="relative"><img src={p.imageUrl||FOOD_PLACEHOLDER} alt={p.name} className="w-full aspect-[1.2/1] object-cover bg-secondary"/><span className="absolute top-3 right-3 status-pill">{p.isAvailable?'Disponible':'Pausado'}</span></div>
        <div className="p-4"><div className="eyebrow text-muted-foreground">{p.category||'Sin categoría'}</div><h3 className="serif text-xl mt-1">{p.name}</h3><div className="flex items-center gap-2 mt-2"><b>{money(currentPrice(p))}</b>{p.offerPrice!==null&&<del className="text-xs text-muted-foreground">{money(p.price)}</del>}</div><p className="text-xs text-muted-foreground line-clamp-2 min-h-8 mt-2">{p.description}</p>
          <div className="grid grid-cols-[1fr_42px_42px] gap-2 mt-4"><button className="btn btn-soft !py-2 text-xs" onClick={()=>onEdit(p)} data-testid={`button-edit-product-${p.id}`}><Edit3 size={14}/>Editar</button>
            <button className={`icon-btn ${p.isAvailable?'text-primary':''}`} aria-label={p.isAvailable?'Pausar producto':'Habilitar producto'} onClick={()=>toggle.mutate({id:p.id,data:{name:p.name,description:p.description,category:p.category,imageUrl:p.imageUrl,price:p.price,offerPrice:p.offerPrice,isAvailable:!p.isAvailable}},{onSuccess:()=>{client.invalidateQueries({queryKey:getGetAdminOverviewQueryKey()});client.invalidateQueries({queryKey:getGetStorefrontQueryKey()});}})} data-testid={`button-toggle-product-${p.id}`}><Check size={15}/></button>
            <button className="icon-btn text-destructive" aria-label="Eliminar producto" onClick={()=>onDelete(p.id)} data-testid={`button-delete-product-${p.id}`}><Trash2 size={15}/></button>
          </div>
        </div>
      </article>)}</div>}
  </section>;
}
function DeliveryTab({zones,onAdd,onEdit,onDelete}:{zones:DeliveryZone[];onAdd:()=>void;onEdit:(z:DeliveryZone)=>void;onDelete:(id:number)=>void}) {
  return <section className="reveal">
    <div className="flex justify-between items-end gap-3 mb-5"><div><div className="eyebrow text-accent">COBERTURA</div><h2 className="serif text-2xl mt-1">Zonas de entrega</h2><p className="text-xs text-muted-foreground mt-1">Define destinos y tarifas claras antes del pago.</p></div><button className="btn btn-primary" onClick={onAdd} data-testid="button-add-zone"><Plus size={15}/>Nueva zona</button></div>
    {zones.length ? <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{zones.map(zone=><article className="panel p-5" key={zone.id} data-testid={`card-zone-${zone.id}`}>
      <div className="flex justify-between items-start"><span className="w-9 h-9 rounded-full bg-secondary grid place-items-center"><MapPin size={17}/></span><StatusPill status={zone.isActive?'confirmed':'rejected'}/></div>
      <h3 className="serif text-2xl mt-4">{zone.name}</h3><div className="text-xs text-muted-foreground mt-1">Tarifa de entrega</div><div className="serif text-2xl mt-1">{money(zone.deliveryFee)}</div>
      <div className="flex gap-2 mt-4"><button className="btn btn-soft flex-1 !py-2 text-xs" onClick={()=>onEdit(zone)} data-testid={`button-edit-zone-${zone.id}`}><Edit3 size={14}/>Editar zona</button><button className="icon-btn text-destructive" onClick={()=>onDelete(zone.id)} aria-label="Eliminar zona" data-testid={`button-delete-zone-${zone.id}`}><Trash2 size={15}/></button></div>
    </article>)}</div> : <EmptyState title="Aún no hay zonas" detail="Añade los barrios donde puedes entregar pedidos." action={<button className="btn btn-primary mt-4" onClick={onAdd} data-testid="button-add-first-zone">Añadir zona</button>}/>}
  </section>;
}
function ZoneEditor({zone,close,saved}:{zone:DeliveryZone|null;close:()=>void;saved:()=>void}) {
  const create=useCreateDeliveryZone(); const update=useUpdateDeliveryZone();
  const [name,setName]=useState(zone?.name||''); const [fee,setFee]=useState(zone?String(zone.deliveryFee):''); const [active,setActive]=useState(zone?.isActive??true);
  const pending=create.isPending||update.isPending;
  const submit=(e:FormEvent)=>{e.preventDefault(); const data:DeliveryZoneInput={name:name.trim(),deliveryFee:Number(fee),isActive:active};
    const callbacks={onSuccess:saved,onError:()=>{}};
    if(zone) update.mutate({id:zone.id,data},callbacks); else create.mutate({data},callbacks);
  };
  return <Modal close={close} title={zone?'Editar zona':'Nueva zona'}>
    <form onSubmit={submit}>
      <Field label="Nombre del barrio o sector"><input value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={80} required placeholder="Ej. Los Palos Grandes" data-testid="input-zone-name"/></Field>
      <Field label="Tarifa de entrega"><input type="number" min="0" step="0.01" value={fee} onChange={e=>setFee(e.target.value)} required placeholder="0" data-testid="input-zone-fee"/></Field>
      <label className="flex gap-3 items-center text-sm mb-5"><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)} data-testid="checkbox-zone-active"/>Zona activa y visible en checkout</label>
      {(create.isError||update.isError)&&<p className="text-xs text-destructive">No se pudo guardar esta zona. Revisa los datos.</p>}
      <div className="flex gap-2"><button type="button" className="btn btn-line flex-1" onClick={close} data-testid="button-cancel-zone">Cancelar</button><button className="btn btn-primary flex-1" disabled={pending} data-testid="button-save-zone">{pending?'Guardando…':'Guardar zona'}</button></div>
    </form>
  </Modal>;
}
function SettingsTab({settings,onSaved}:{settings:StoreSettings;onSaved:()=>void}) {
  const save=useUpdateStoreSettings();
  const [form,setForm]=useState<StoreSettingsInput>(()=>({...settings}));
  useEffect(()=>setForm({...settings}),[settings]);
  const patch=(key:keyof StoreSettingsInput,value:string|boolean|null)=>setForm(old=>({...old,[key]:value}));
  const submit=(e:FormEvent)=>{e.preventDefault();save.mutate({data:form},{onSuccess:onSaved});};
  return <div className="grid lg:grid-cols-[1fr_300px] gap-5 reveal">
    <form className="panel p-5 sm:p-7" onSubmit={submit}>
      <div className="eyebrow text-accent">IDENTIDAD Y OPERACIÓN</div><h2 className="serif text-2xl mt-1 mb-5">Detalles del negocio</h2>
      <div className="grid sm:grid-cols-2 gap-x-4">
        <Field label="Nombre de la tienda"><input value={form.storeName} onChange={e=>patch('storeName',e.target.value)} minLength={2} maxLength={100} required data-testid="input-store-name"/></Field>
        <Field label="Frase corta"><input value={form.tagline} onChange={e=>patch('tagline',e.target.value)} maxLength={180} placeholder="Lo bueno se comparte" data-testid="input-store-tagline"/></Field>
        <Field label="WhatsApp del negocio"><input value={form.whatsappNumber} onChange={e=>patch('whatsappNumber',e.target.value)} minLength={7} maxLength={20} required data-testid="input-store-whatsapp"/></Field>
        <Field label="Dirección física"><input value={form.physicalAddress} onChange={e=>patch('physicalAddress',e.target.value)} maxLength={300} data-testid="input-store-address"/></Field>
      </div>
      <div className="border-t border-border my-3 pt-5"><div className="eyebrow text-accent">PAGO MÓVIL</div><p className="text-xs text-muted-foreground mt-1 mb-4">Estos datos se muestran en checkout. La verificación del pago siempre es manual.</p></div>
      <div className="grid sm:grid-cols-3 gap-x-4"><Field label="Banco"><input value={form.bankName} onChange={e=>patch('bankName',e.target.value)} maxLength={100} data-testid="input-bank-name"/></Field><Field label="Cédula o RIF"><input value={form.bankId} onChange={e=>patch('bankId',e.target.value)} maxLength={20} data-testid="input-bank-id"/></Field><Field label="Teléfono"><input value={form.bankPhone} onChange={e=>patch('bankPhone',e.target.value)} maxLength={20} data-testid="input-bank-phone"/></Field></div>
      <div className="grid sm:grid-cols-2 gap-3 mt-2">
        <Toggle label="Recibir pedidos" checked={form.isOpen} onChange={v=>patch('isOpen',v)} testId="toggle-store-open"/>
        <Toggle label="Permitir retiro en tienda" checked={form.pickupEnabled} onChange={v=>patch('pickupEnabled',v)} testId="toggle-pickup-enabled"/>
      </div>
      <Field label="Webhook de pedidos (opcional)"><input value={form.webhookUrl||''} onChange={e=>patch('webhookUrl',e.target.value||null)} type="url" placeholder="https://" data-testid="input-webhook-url"/></Field>
      {save.isError&&<p className="text-xs text-destructive mb-3">No se guardaron los cambios. Inténtalo de nuevo.</p>}
      <button className="btn btn-primary w-full sm:w-auto" disabled={save.isPending} data-testid="button-save-settings">{save.isPending?'Guardando…':'Guardar cambios'}<Check size={15}/></button>
    </form>
    <aside className="panel p-5 h-fit">
      <div className="eyebrow text-accent">IMAGEN DEL NEGOCIO</div><h3 className="serif text-xl mt-1">Logo o avatar</h3><p className="text-xs text-muted-foreground mt-1 mb-4">Recorte cuadrado para la cabecera de tu menú.</p>
      <CropUpload value={settings.logoUrl} onUploaded={url=>patch('logoUrl',url)} testId="store-logo"/>
      <p className="text-[10px] text-muted-foreground mt-3">Guarda los cambios para publicar la nueva imagen.</p>
    </aside>
  </div>;
}
function Toggle({label,checked,onChange,testId}:{label:string;checked:boolean;onChange:(v:boolean)=>void;testId:string}) {
  return <label className="panel p-3.5 flex justify-between gap-4 items-center cursor-pointer mb-4"><span className="text-xs font-bold">{label}</span><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} data-testid={testId}/></label>;
}
function ProductEditor({product,close,saved}:{product:Product|null;close:()=>void;saved:()=>void}) {
  const create=useCreateProduct(); const update=useUpdateProduct();
  const [form,setForm]=useState<ProductInput>({
    name:product?.name||'',description:product?.description||'',category:product?.category||'',
    imageUrl:product?.imageUrl||null,price:product?.price||0,offerPrice:product?.offerPrice??null,isAvailable:product?.isAvailable??true,
  });
  const [offerEnabled,setOfferEnabled]=useState(product?.offerPrice!==null&&product?.offerPrice!==undefined);
  const patch=(key:keyof ProductInput,value:string|number|null|boolean)=>setForm(old=>({...old,[key]:value}));
  const pending=create.isPending||update.isPending;
  const submit=(e:FormEvent)=>{e.preventDefault();const data={...form,price:Number(form.price),offerPrice:offerEnabled&&form.offerPrice?Number(form.offerPrice):null};
    if(product) update.mutate({id:product.id,data},{onSuccess:saved}); else create.mutate({data},{onSuccess:saved});
  };
  return <Modal close={close} title={product?'Editar publicación':'Nueva publicación'} wide>
    <form onSubmit={submit} className="grid md:grid-cols-[220px_1fr] gap-5">
      <div><div className="eyebrow text-muted-foreground mb-2">FOTO DEL PLATO</div><CropUpload value={form.imageUrl} onUploaded={url=>patch('imageUrl',url)} testId="product-image"/><p className="text-[10px] text-muted-foreground mt-2">Imagen recortada en formato 1:1.</p></div>
      <div>
        <Field label="Nombre del plato"><input value={form.name} onChange={e=>patch('name',e.target.value)} minLength={2} maxLength={100} required placeholder="Arepa de reina pepiada" data-testid="input-product-name"/></Field>
        <Field label="Descripción"><textarea value={form.description} onChange={e=>patch('description',e.target.value)} maxLength={1000} placeholder="Ingredientes, preparación, detalles…" data-testid="input-product-description"/></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Categoría"><input value={form.category} onChange={e=>patch('category',e.target.value)} maxLength={60} placeholder="Desayunos" data-testid="input-product-category"/></Field><Field label="Precio ($)"><input type="number" min="0.01" step="0.01" value={form.price||''} onChange={e=>patch('price',Number(e.target.value))} required data-testid="input-product-price"/></Field></div>
        <Toggle label="Disponible para pedidos" checked={form.isAvailable} onChange={v=>patch('isAvailable',v)} testId="toggle-product-available"/>
        <label className="flex items-center gap-2 text-xs font-bold mb-2"><input type="checkbox" checked={offerEnabled} onChange={e=>setOfferEnabled(e.target.checked)} data-testid="checkbox-offer-enabled"/>Precio de oferta</label>
        {offerEnabled&&<Field label="Precio de oferta ($)"><input type="number" min="0.01" step="0.01" value={form.offerPrice??''} onChange={e=>patch('offerPrice',e.target.value?Number(e.target.value):null)} required data-testid="input-product-offer"/></Field>}
        {(create.isError||update.isError)&&<p className="text-xs text-destructive mb-3">No se pudo guardar el producto. Revisa los campos.</p>}
        <div className="flex gap-2 mt-4"><button type="button" className="btn btn-line flex-1" onClick={close} data-testid="button-cancel-product">Cancelar</button><button className="btn btn-primary flex-1" disabled={pending} data-testid="button-save-product">{pending?'Guardando…':'Guardar producto'}<Check size={15}/></button></div>
      </div>
    </form>
  </Modal>;
}
function CropUpload({value,onUploaded,testId}:{value:string|null|undefined;onUploaded:(url:string)=>void;testId:string}) {
  const upload=useUploadStoreImage();
  const [file,setFile]=useState<File|null>(null);
  const [preview,setPreview]=useState('');
  const [zoom,setZoom]=useState(1);
  const imgRef=useRef<HTMLImageElement|null>(null);
  const cropperRef=useRef<Cropper|null>(null);
  useEffect(()=>{if(!file){setPreview('');return;} const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  useEffect(()=>{
    if(!preview||!imgRef.current) return;
    const cropper=new Cropper(imgRef.current,{aspectRatio:1,viewMode:1,autoCropArea:1,background:false,responsive:true,cropBoxResizable:false,dragMode:'move'});
    cropperRef.current=cropper;
    cropper.zoomTo(zoom);
    return()=>{cropper.destroy();cropperRef.current=null;};
  },[preview]);
  const crop=async()=>{
    const canvas=cropperRef.current?.getCroppedCanvas({width:900,height:900,imageSmoothingEnabled:true,imageSmoothingQuality:'high'});
    if(!canvas) return;
    const blob:Blob|null=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.88));
    if(!blob) return;
    upload.mutate({data:{image:blob}},{onSuccess:res=>{onUploaded(res.url);setFile(null);},onError:()=>{}});
  };
  return <div>
    <div className="relative w-full aspect-square rounded-2xl border border-border overflow-hidden bg-secondary">
      {value&&!preview&&<img src={value} alt="Imagen actual" className="absolute inset-0 w-full h-full object-cover"/>}
      {!value&&!preview&&<div className="absolute inset-0 grid place-items-center text-center text-muted-foreground"><ImagePlus size={23}/><span className="text-[10px]">Sin imagen</span></div>}
      {preview&&<img ref={imgRef} src={preview} alt="Previsualización para recorte" className="cropper-source"/>}
      {upload.isPending&&<div className="absolute inset-0 bg-background/80 grid place-items-center text-xs font-bold">Subiendo imagen…</div>}
    </div>
    {preview&&<div className="mt-2"><label className="text-[10px] text-muted-foreground">Encuadre</label><input type="range" min="1" max="2.5" step=".05" value={zoom} onChange={e=>{const next=Number(e.target.value);setZoom(next);cropperRef.current?.zoomTo(next);}} className="w-full" data-testid={`input-crop-zoom-${testId}`}/><div className="flex gap-2"><button type="button" className="btn btn-primary flex-1 !py-2 text-[11px]" onClick={crop} disabled={upload.isPending} data-testid={`button-crop-upload-${testId}`}>Recortar y subir</button><button type="button" className="icon-btn" onClick={()=>setFile(null)} aria-label="Cancelar recorte" data-testid={`button-cancel-crop-${testId}`}><X size={14}/></button></div></div>}
     {!preview&&<label className="btn btn-soft w-full !mt-3 !py-2.5 text-xs cursor-pointer"><ImagePlus size={14}/>{value?'Cambiar imagen':'Elegir imagen'}<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={e=>{const selected=e.target.files?.[0];if(selected){setZoom(1);setFile(selected);}}} data-testid={`input-image-${testId}`}/></label>}
    {upload.isError&&<p className="text-[10px] text-destructive mt-2">No se pudo subir la imagen. Prueba con otra.</p>}
  </div>;
}
function Modal({title,children,close,wide}:{title:string;children:ReactNode;close:()=>void;wide?:boolean}) {
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close();}}><section className={`modal ${wide?'!max-w-[760px]':''}`} role="dialog" aria-modal="true" aria-label={title}>
    <div className="flex justify-between items-start gap-4 mb-5"><div><div className="eyebrow text-accent">MENÚ LOCAL</div><h2 className="serif text-3xl mt-1">{title}</h2></div><button className="icon-btn" onClick={close} aria-label="Cerrar" data-testid="button-close-modal"><X size={17}/></button></div>{children}
  </section></div>;
}
function Router() {
  return <ErrorBoundary>
    <Switch>
      <Route path="/" component={ShopHome}/>
      <Route path="/p/:slug" component={ProductPage}/>
      <Route path="/checkout" component={CheckoutPage}/>
      <Route path="/admin" component={AdminGate}/>
      <Route component={NotFound}/>
    </Switch>
  </ErrorBoundary>;
}
function App() {
  return <QueryClientProvider client={queryClient}>
    <TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/,'')}><Router/></WouterRouter><Toaster/></TooltipProvider>
  </QueryClientProvider>;
}
export default App;
