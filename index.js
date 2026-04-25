require('dotenv').config();
const connectDB = require('./config/db');
const express = require('express');
const cors = require('cors');
const Wallet = require('./models/Wallet');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3003;

connectDB();

app.post('/wallet/create', async (req, res) => {
    try {
        const { userId } = req.body;
        let wallet = await Wallet.findOne({ userId });
        if (wallet) return res.status(400).json({ error: 'Wallet already exists' });

        wallet = new Wallet({ userId, balance: 0 });
        await wallet.save();

        res.status(201).json(wallet);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.get('/wallet/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const wallet = await Wallet.findOne({ userId });
        if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

        res.status(200).json({ userId, balance: wallet.balance, source: 'db' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/wallet/:userId', async (req, res) => {
    try {
        const result = await Wallet.deleteOne({ userId: req.params.userId });
        res.status(200).json({ deleted: result.deletedCount > 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/wallet/fund', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        if (amount <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

        const wallet = await Wallet.findOne({ userId });
        if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

        wallet.balance += amount;
        await wallet.save();

        res.status(200).json(wallet);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.patch('/wallet/update', async (req, res) => {
    try {
        const { userId, amount } = req.body;
        const wallet = await Wallet.findOne({ userId });
        if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
        if (wallet.balance + amount < 0) return res.status(400).json({ error: 'Insufficient funds' });
        wallet.balance += amount;
        await wallet.save();
        res.status(200).json(wallet);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/wallet/pay', async (req, res) => {
    try {
        const { userId, orderId } = req.body;
        if (!userId || !orderId) return res.status(400).json({ error: 'userId and orderId are required' });

        const ORDER_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:3002';
        const INVOICE_URL = process.env.INVOICE_SERVICE_URL || 'http://invoice-service:3005';

        const orderRes = await fetch(`${ORDER_URL}/orders/${orderId}`);
        if (!orderRes.ok) return res.status(404).json({ error: 'Order not found' });
        const { order } = await orderRes.json();

        if (order.status !== 'APPROVED')
            return res.status(400).json({ error: 'Order must be APPROVED before payment' });
        if (order.paymentStatus === 'PAID')
            return res.status(400).json({ error: 'Order already paid' });
        if (String(order.userId) !== String(userId))
            return res.status(403).json({ error: 'You can only pay for your own orders' });

        const wallet = await Wallet.findOne({ userId });
        if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
        if (wallet.balance < order.amount) return res.status(400).json({ error: 'Insufficient funds' });
        wallet.balance -= order.amount;
        await wallet.save();

        const payRes = await fetch(`${ORDER_URL}/orders/${orderId}/pay`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
        const payPayload = await payRes.json().catch(() => ({}));
        if (!payRes.ok) {
            wallet.balance += order.amount;
            await wallet.save();
            return res.status(payRes.status).json({
                error: payPayload.message || payPayload.error || 'Could not mark the order as paid',
            });
        }

        let invoice = null;
        let invoiceError = null;
        const invoiceRes = await fetch(`${INVOICE_URL}/invoices`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orderId,
                userId: order.userId,
                userName: order.userName,
                userEmail: order.userEmail,
                serviceId: order.serviceId,
                serviceName: order.serviceName,
                description: order.description,
                amount: order.amount,
                address: order.address,
                scheduledDate: order.scheduledDate,
            }),
        });
        const invoicePayload = await invoiceRes.json().catch(() => ({}));
        if (invoiceRes.ok) {
            invoice = invoicePayload.invoice || invoicePayload;
        } else {
            invoiceError = invoicePayload.message || invoicePayload.error || 'Invoice generation failed';
            console.error('[wallet-service] invoice creation failed:', invoiceError);
        }

        res.status(200).json({
            message: invoiceError ? 'Payment successful, but invoice generation is pending.' : 'Payment successful',
            wallet,
            invoice,
            invoiceError,
        });
    } catch (error) {
        console.error('[wallet-service] /wallet/pay error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'wallet-service', timestamp: new Date().toISOString() }));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[wallet-service] running on port ${PORT}`);
});
