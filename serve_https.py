import http.server
import ssl
import sys

port = 8443
server_address = ('0.0.0.0', port)
handler = http.server.SimpleHTTPRequestHandler

httpd = http.server.HTTPServer(server_address, handler)

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain(certfile='server.crt', keyfile='server.key')
httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

print(f"🔒 Vocab AI HTTPS server running on https://192.168.1.10:{port}")
print("Press Ctrl+C to stop.")
try:
    httpd.serve_forever()
except KeyboardInterrupt:
    print("\nServer stopped.")
    sys.exit(0)
