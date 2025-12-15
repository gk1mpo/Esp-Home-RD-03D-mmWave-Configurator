static uint32_t last_run = 0;
const uint32_t now = millis();
// user throttle
std::string sel = id(update_speed).state.c_str();
uint32_t period_ms = 1000;
if (sel == "Medium")
    period_ms = 500;
else if (sel == "Fast")
    period_ms = 100;
if ((now - last_run) < period_ms)
    return;
last_run = now;

uint32_t t0 = millis();

static std::vector<uint8_t> acc;
static size_t offset = 0;

// Pull bytes into buffer
while (id(rd03_uart).available() > 0)
{
    uint8_t b;
    id(rd03_uart).read_byte(&b);
    acc.push_back(b);
}

// How many bytes are actually pending after the current read position
size_t avail = (acc.size() > offset) ? (acc.size() - offset) : 0;
id(uart_bytes_pending) = (uint16_t)avail;

// Hard cap to avoid unbounded growth
const size_t MAX_BUF = 512;
if (acc.size() > MAX_BUF)
{
    size_t drop = acc.size() - MAX_BUF;
    if (drop > offset)
        drop = offset;
    if (drop > 0)
    {
        acc.erase(acc.begin(), acc.begin() + drop);
        offset -= drop;
    }
    avail = (acc.size() > offset) ? (acc.size() - offset) : 0;
    id(uart_frames_bad)++; // we had to drop data
}

auto ru16 = [&](const std::vector<uint8_t> &v, int i) -> uint16_t
{
    return (uint16_t)v[i] | ((uint16_t)v[i + 1] << 8);
};
auto sfix = [&](uint16_t raw) -> int32_t
{
    bool neg = ((raw & 0x8000) == 0);
    int32_t mag = (int32_t)(raw & 0x7FFF);
    return neg ? -mag : mag;
};
const uint8_t H0 = 0xAA, H1 = 0xFF, H2 = 0x03, H3 = 0x00, T0 = 0x55, T1 = 0xCC;

while (true)
{
    avail = (acc.size() > offset) ? (acc.size() - offset) : 0;
    if (avail < 14)
        break;

    // Pointer to first byte of candidate frame
    const uint8_t *p = acc.data() + offset;

    // Sync to header
    if (!(p[0] == H0 && p[1] == H1 && p[2] == H2 && p[3] == H3))
    {
        offset++; // slide by one, no massive erase
        continue;
    }

    bool have30 = (avail >= 30) && (p[28] == T0 && p[29] == T1);
    bool have14 = (avail >= 14) && (p[12] == T0 && p[13] == T1);

    if (!have30 && !have14)
    {
        if (avail >= 30)
        {
            offset++; // bad frame, move on
            id(uart_frames_bad)++;
            continue;
        }
        break; // wait for more bytes
    }

    // Reset targets
    id(t1_detected) = id(t2_detected) = id(t3_detected) = false;
    id(target_count) = 0;
    id(nearest_m) = 0.0f;

    if (have30)
    {
        // Copy just the frame slice
        std::vector<uint8_t> f(acc.begin() + offset, acc.begin() + offset + 30);
        offset += 30;

        auto handle = [&](int base, int idx)
        {
            uint16_t xr = ru16(f, base + 0), yr = ru16(f, base + 2), vr = ru16(f, base + 4);
            int32_t xmm = sfix(xr), ymm = sfix(yr), vcm = sfix(vr);
            bool det = (xmm || ymm || vcm);
            if (!det)
                return;
            float x = xmm / 1000.0f, y = ymm / 1000.0f, v = vcm / 100.0f;
            float d = sqrtf(x * x + y * y);
            const float PI = 3.14159265f;
            float ang = atan2f(y, x) * 180.0f / PI;
            if (idx == 1)
            {
                id(t1_detected) = true;
                id(t1_x_m) = x;
                id(t1_y_m) = y;
                id(t1_speed_mps) = v;
                id(t1_dist_m) = d;
                id(t1_angle_deg) = ang;
            }
            if (idx == 2)
            {
                id(t2_detected) = true;
                id(t2_x_m) = x;
                id(t2_y_m) = y;
                id(t2_speed_mps) = v;
                id(t2_dist_m) = d;
                id(t2_angle_deg) = ang;
            }
            if (idx == 3)
            {
                id(t3_detected) = true;
                id(t3_x_m) = x;
                id(t3_y_m) = y;
                id(t3_speed_mps) = v;
                id(t3_dist_m) = d;
                id(t3_angle_deg) = ang;
            }
            if (id(nearest_m) == 0.0f || d < id(nearest_m))
                id(nearest_m) = d;
            id(target_count)++;
        };
        handle(4, 1);
        handle(12, 2);
        handle(20, 3);
        if (id(target_count) > 0)
            id(last_seen_ms) = millis();
    }
    else
    { // 14-byte single-target frame
        std::vector<uint8_t> f(acc.begin() + offset, acc.begin() + offset + 14);
        offset += 14;
        uint16_t xr = ru16(f, 4), yr = ru16(f, 6), vr = ru16(f, 8);
        int32_t xmm = sfix(xr), ymm = sfix(yr), vcm = sfix(vr);
        bool det = (xmm || ymm || vcm);
        if (det)
        {
            float x = xmm / 1000.0f, y = ymm / 1000.0f, v = vcm / 100.0f;
            float d = sqrtf(x * x + y * y);
            const float PI = 3.14159265f;
            float ang = atan2f(y, x) * 180.0f / PI;
            float install_offset = id(epl_install_angle).state;
            ang += install_offset;
            if (ang > 180.0f)
                ang -= 360.0f;
            if (ang < -180.0f)
                ang += 360.0f;
            id(t1_detected) = true;
            id(t1_x_m) = x;
            id(t1_y_m) = y;
            id(t1_speed_mps) = v;
            id(t1_dist_m) = d;
            id(t1_angle_deg) = ang;
            id(target_count) = 1;
            id(nearest_m) = d;
            id(last_seen_ms) = millis();
        }
    }

    id(uart_frames_parsed)++;
}

// Compact vector occasionally so offset never grows without bound
if (offset > 0 && offset > acc.size() / 2)
{
    acc.erase(acc.begin(), acc.begin() + offset);
    offset = 0;
}

id(uart_loop_ms) = (uint16_t)(millis() - t0);

// reset targets
id(t1_detected) = id(t2_detected) = id(t3_detected) = false;
id(target_count) = 0;
id(nearest_m) = 0.0f;

if (have30)
{
    std::vector<uint8_t> f(acc.begin(), acc.begin() + 30);
    acc.erase(acc.begin(), acc.begin() + 30);
    auto handle = [&](int base, int idx)
    {
        uint16_t xr = ru16(f, base + 0), yr = ru16(f, base + 2), vr = ru16(f, base + 4);
        int32_t xmm = sfix(xr), ymm = sfix(yr), vcm = sfix(vr);
        bool det = (xmm || ymm || vcm);
        if (!det)
            return;
        float x = xmm / 1000.0f, y = ymm / 1000.0f, v = vcm / 100.0f;
        float d = sqrtf(x * x + y * y);
        const float PI = 3.14159265f;
        float ang = atan2f(y, x) * 180.0f / PI;
        if (idx == 1)
        {
            id(t1_detected) = true;
            id(t1_x_m) = x;
            id(t1_y_m) = y;
            id(t1_speed_mps) = v;
            id(t1_dist_m) = d;
            id(t1_angle_deg) = ang;
        }
        if (idx == 2)
        {
            id(t2_detected) = true;
            id(t2_x_m) = x;
            id(t2_y_m) = y;
            id(t2_speed_mps) = v;
            id(t2_dist_m) = d;
            id(t2_angle_deg) = ang;
        }
        if (idx == 3)
        {
            id(t3_detected) = true;
            id(t3_x_m) = x;
            id(t3_y_m) = y;
            id(t3_speed_mps) = v;
            id(t3_dist_m) = d;
            id(t3_angle_deg) = ang;
        }
        if (id(nearest_m) == 0.0f || d < id(nearest_m))
            id(nearest_m) = d;
        id(target_count)++;
    };
    handle(4, 1);
    handle(12, 2);
    handle(20, 3);
    if (id(target_count) > 0)
        id(last_seen_ms) = millis();
}
else
{ // have14
    std::vector<uint8_t> f(acc.begin(), acc.begin() + 14);
    acc.erase(acc.begin(), acc.begin() + 14);
    uint16_t xr = ru16(f, 4), yr = ru16(f, 6), vr = ru16(f, 8);
    int32_t xmm = sfix(xr), ymm = sfix(yr), vcm = sfix(vr);
    bool det = (xmm || ymm || vcm);
    if (det)
    {
        float x = xmm / 1000.0f, y = ymm / 1000.0f, v = vcm / 100.0f;
        float d = sqrtf(x * x + y * y);
        const float PI = 3.14159265f;
        float ang = atan2f(y, x) * 180.0f / PI;
        float install_offset = id(epl_install_angle).state;
        ang += install_offset;
        if (ang > 180.0f)
            ang -= 360.0f;
        if (ang < -180.0f)
            ang += 360.0f;

        id(t1_detected) = true;
        id(t1_x_m) = x;
        id(t1_y_m) = y;
        id(t1_speed_mps) = v;
        id(t1_dist_m) = d;
        id(t1_angle_deg) = ang;
        id(target_count) = 1;
        id(nearest_m) = d;
        id(last_seen_ms) = millis();
    }
}
}