// Super Share — công cụ tab BM (chép SMIT). Dùng hàm chung self.vaesaSmitNoi (smit.js), đăng ký lệnh vào self.vaesaSmitThem.
;(() => {
const N = self.vaesaSmitNoi
if (!N) return
const LENH = {}
self.vaesaSmitThem = Object.assign(self.vaesaSmitThem || {}, LENH)
})()
