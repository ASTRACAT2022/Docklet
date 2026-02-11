package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"flag"
	"fmt"
	"math/big"
	"net"
	"os"
	"strings"
	"time"
)

func main() {
	ipList := flag.String("ip", "127.0.0.1,::1", "Comma separated list of IPs for Server Cert")
	flag.Parse()

	if err := os.MkdirAll("certs", 0755); err != nil {
		panic(err)
	}

	ips := []net.IP{}
	for _, ipStr := range strings.Split(*ipList, ",") {
		if ip := net.ParseIP(strings.TrimSpace(ipStr)); ip != nil {
			ips = append(ips, ip)
		}
	}

	fmt.Println("Generating CA support...")
	caCert, caKey, err := generateCA()
	if err != nil {
		panic(err)
	}

	fmt.Println("Generating Server Certificate (IPs:", ips, ")...")
	if err := generateCert("server", caCert, caKey, true, ips); err != nil {
		panic(err)
	}

	fmt.Println("Generating Agent Certificate...")
	if err := generateCert("agent", caCert, caKey, false, nil); err != nil {
		panic(err)
	}

	fmt.Println("Generating Client (CLI) Certificate...")
	if err := generateCert("client", caCert, caKey, false, nil); err != nil {
		panic(err)
	}

	fmt.Println("✅ Certificates generated in certs/ directory")
}

func generateCA() (*x509.Certificate, *rsa.PrivateKey, error) {
	ca := &x509.Certificate{
		SerialNumber: big.NewInt(2024),
		Subject: pkix.Name{
			Organization: []string{"Docklet CA"},
			CommonName:   "Docklet Root CA",
		},
		NotBefore:             time.Now(),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		IsCA:                  true,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		BasicConstraintsValid: true,
	}

	caPrivKey, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return nil, nil, err
	}

	caBytes, err := x509.CreateCertificate(rand.Reader, ca, ca, &caPrivKey.PublicKey, caPrivKey)
	if err != nil {
		return nil, nil, err
	}

	// Save CA
	savePEM("certs/ca-cert.pem", "CERTIFICATE", caBytes)
	savePEM("certs/ca-key.pem", "RSA PRIVATE KEY", x509.MarshalPKCS1PrivateKey(caPrivKey))

	return ca, caPrivKey, nil
}

func generateCert(name string, ca *x509.Certificate, caKey *rsa.PrivateKey, isServer bool, ips []net.IP) error {
	cert := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject: pkix.Name{
			Organization: []string{"Docklet Corp"},
			CommonName:   "docklet-" + name,
		},
		NotBefore:    time.Now(),
		NotAfter:     time.Now().AddDate(1, 0, 0),
		SubjectKeyId: []byte{1, 2, 3, 4, 6},
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth, x509.ExtKeyUsageServerAuth},
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}

	if isServer {
		cert.IPAddresses = ips
		if len(ips) == 0 {
			cert.IPAddresses = []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("::1")}
		}
		cert.DNSNames = []string{"localhost"}
	}

	certPrivKey, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return err
	}

	certBytes, err := x509.CreateCertificate(rand.Reader, cert, ca, &certPrivKey.PublicKey, caKey)
	if err != nil {
		return err
	}

	savePEM(fmt.Sprintf("certs/%s-cert.pem", name), "CERTIFICATE", certBytes)
	savePEM(fmt.Sprintf("certs/%s-key.pem", name), "RSA PRIVATE KEY", x509.MarshalPKCS1PrivateKey(certPrivKey))

	return nil
}

func savePEM(fileName string, pemType string, bytes []byte) {
	out, err := os.Create(fileName)
	if err != nil {
		panic(err)
	}
	defer out.Close()

	pem.Encode(out, &pem.Block{
		Type:  pemType,
		Bytes: bytes,
	})
}
