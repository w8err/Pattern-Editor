# 캐시를 끄는 정적 서버 (ES 모듈 캐시 문제 방지) — 새로고침만으로 최신 반영
import http.server, socketserver, os

os.chdir(os.path.join(os.path.dirname(__file__), '..'))  # editor/ 를 루트로
PORT = 8080

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def log_message(self, *a):  # 조용히
        pass

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('', PORT), NoCache) as httpd:
    print(f'no-cache server on http://localhost:{PORT}')
    httpd.serve_forever()
