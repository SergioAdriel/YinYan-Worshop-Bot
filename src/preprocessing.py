"""Normalización compartida con web/ml.js; no requiere descargas de corpus."""
import re
import unicodedata

STOPWORDS = sorted(set("a al algo algun alguna algunas algunos ante aqui asi cada como con cual cuando de del desde donde el ella ellas ellos en entre era es esa esas ese esos esta estas este esto estos fue ha hasta hay la las le les lo los mas me mi mis muy ni o para pero por porque que quien se ser sin sobre su sus te tengo tiene tu un una unas uno unos y ya yo".split()))

# Lematización ligera y explícita: solo variantes flexivas, nunca etiquetas
# de intención. Su tamaño limitado es una limitación documentada.
LEMMA_MAP = {
    "enciende":"encender", "encienden":"encender", "encendiendo":"encender", "encendio":"encender", "encendida":"encender", "encendido":"encender", "encendidas":"encender", "encendidos":"encender",
    "prende":"prender", "prenden":"prender", "prendio":"prender", "prendiendo":"prender", "prendida":"prender", "prendido":"prender",
    "arranca":"arrancar", "arrancan":"arrancar", "arranco":"arrancar", "arranque":"arrancar",
    "carga":"cargar", "cargan":"cargar", "cargando":"cargar", "cargue":"cargar", "cargado":"cargar",
    "calienta":"calentar", "calientan":"calentar", "calentando":"calentar", "caliente":"calentar", "calientes":"calentar",
    "lenta":"lento", "lentas":"lento", "lentos":"lento", "lentitud":"lento",
    "conecta":"conectar", "conectan":"conectar", "conectado":"conectar", "conectada":"conectar", "conectados":"conectar", "conectadas":"conectar", "conectarse":"conectar", "conectando":"conectar",
    "desconecta":"desconectar", "desconectan":"desconectar", "desconectado":"desconectar", "desconectada":"desconectar",
    "funciona":"funcionar", "funcionan":"funcionar", "funcionando":"funcionar",
    "pantallas":"pantalla", "baterias":"bateria", "botones":"boton", "teclas":"tecla", "controles":"control", "mandos":"mando", "juegos":"juego", "programas":"programa", "archivos":"archivo", "redes":"red", "discos":"disco", "aplicaciones":"aplicacion", "computadoras":"computadora", "celulares":"celular", "consolas":"consola", "telefonos":"telefono", "audifonos":"audifono", "altavoces":"altavoz", "bocinas":"bocina", "ventiladores":"ventilador", "luces":"luz", "errores":"error", "precios":"precio", "tarifas":"tarifa", "cotizaciones":"cotizacion",
    "mojo":"mojar", "moje":"mojar", "mojada":"mojar", "mojado":"mojar", "mojarse":"mojar",
    "reparaciones":"reparacion", "actualizaciones":"actualizacion", "actualizarse":"actualizar", "roto":"roto", "rota":"roto", "rotas":"roto", "rotos":"roto"
}

def normalize(text):
    text = unicodedata.normalize("NFD", str(text).lower())
    return "".join(c for c in text if unicodedata.category(c) != "Mn")

def tokenize(text):
    return [LEMMA_MAP.get(t, t) for t in re.findall(r"[a-z0-9]+", normalize(text)) if t not in STOPWORDS]
